import {notifyFailOverFailed, notifyFailOverSucceeded} from './../notificationService.js'
import appConfig from '../appConfig.js'
import {isLeader} from '../appState.js'
import {dnsManager} from '../dns/dnsManager.js'
import {
  broadcastActiveAddresses,
  broadcastHealthCheckUpdate,
  broadcastRequestForHealthCheck,
  broadcastResetPolling,
} from '../socket/captainSocketServerManager.js'
import {
  FAILOVER_PROGRESS,
  HEALTH_CHECK_REQUEST_VERIFY_STATE,
  RESET_POLLING_REQUEST_POLLING_TYPE,
  WEB_SERVICE_STATUS,
  checkCombinedPeerStateAndInitiateAddActiveIP,
  checkCombinedPeerStateAndInitiateRemoveActiveIP,
  ipPassFailState,
  readResponseBodyFromHealthCheck,
  typeWebServiceConf,
  typeWebServiceState,
  verifyPassingAggreement,
} from './webServiceHelper.js'
import http from 'http'
import https from 'https'
import {logger} from './../coreUtils.js'

/**
 * Maintains state and handles 'polling' for each service
 *
 * @class WebServiceManager
 */
export class WebServiceManager {
  /**
   * Holds web service configuration as read from /data/services.yaml for this specific web service
   *
   * @type {typeWebServiceConf}
   * @memberof WebServiceManager
   */
  serviceConf: typeWebServiceConf

  /**
   * Holds dynamic information like 'checks' data
   *
   * @type {typeWebServiceState}
   * @memberof WebServiceManager
   */
  serviceState: typeWebServiceState

  _initiatePollCounter = 0
  _pollLoopReference: any
  _activePollID!: string

  _failOverCoolDownLoopReference: any

  /* 
    Start of 'Basic getters and setters'
  */

  /**
   * Unique identifier for each web service
   * Using 'zone_record' as serviceKey, maybe use 'name' ?
   */
  public get serviceKey() {
    return this.serviceConf.zone_record
  }

  get unhealthyInterval() {
    return this.serviceConf.unhealthy_interval || appConfig.DEFAULT_HEALTHY_INTERVAL
  }

  get healthyInterval() {
    return this.serviceConf.healthy_interval || appConfig.DEFAULT_UNHEALTHY_INTERVAL
  }

  get fall() {
    return this.serviceConf.fall || appConfig.DEFAULT_FALL
  }

  get rise() {
    return this.serviceConf.rise || appConfig.DEFAULT_RISE
  }

  get connectTimeout() {
    return this.serviceConf.connect_timeout || appConfig.DEFAULT_CONNECT_TIMEOUT
  }

  get readTimeout() {
    return this.serviceConf.read_timeout || appConfig.DEFAULT_READ_TIMEOUT
  }

  get coolDown() {
    return this.serviceConf.cool_down || appConfig.DEFAULT_COOL_DOWN
  }

  get logID() {
    return `SERVICE: ${this.serviceConf.name}(${this.serviceConf.zone_record}):`
  }

  get pollLogID() {
    return `${this.logID} ${this._activePollID}:`
  }

  /**
   * Map of 'ipaddress' vs 'PassFailState' as tracked by the current captain instance
   *
   * @readonly
   * @type {{ [ipAddress: string]: ipPassFailState }}
   * @memberof WebServiceManager
   */
  public getChecksDataByCurrentCaptainInstance(): {[ipAddress: string]: ipPassFailState} {
    return this.serviceState.checks[appConfig.SELF_URL]!
  }

  /**
   * Map of 'ipaddress' vs 'PassFailState' as tracked by the given captain instance
   *
   * @param {string} captainUrl
   * @return {*}  {{ [ipAddress: string]: ipPassFailState }}
   * @memberof WebServiceManager
   */
  public getChecksDataByGivenCaptain(captainUrl: string): {[ipAddress: string]: ipPassFailState} {
    return this.serviceState.checks[captainUrl]!
  }

  /**
   * Map of 'trackedByCaptainUrl' vs 'PassFailState' for given ip address
   *
   * @param {string} ipAddress
   * @return {*}  {{ [trackedByCaptainUrl: string]: ipPassFailState }}
   * @memberof WebServiceManager
   */
  public getChecksDataForGivenIP(ipAddress: string): {[trackedByCaptainUrl: string]: ipPassFailState} {
    const dataForGivenIP: {
      [captainURL: string]: ipPassFailState
    } = {}
    for (const eachCaptainUrl of Object.keys(this.serviceState.checks)) {
      dataForGivenIP[eachCaptainUrl] = this.serviceState.checks[eachCaptainUrl]![ipAddress]!
    }
    return dataForGivenIP
  }

  /* 
    End of 'Basic getters and setters'
  */

  constructor(serviceConf: typeWebServiceConf) {
    const currentDateTime = new Date()
    this.serviceConf = serviceConf
    this.serviceState = {
      is_remote: false,
      is_orphan: false,
      mates: null,
      checks: {
        [appConfig.SELF_URL]: serviceConf.addresses.reduce((accumulator: any, eachAddress: string) => {
          accumulator[eachAddress] = {
            failing: 0,
            passing: 0,
            last_update: currentDateTime,
          }
          return accumulator
        }, {}),
      },
      active: [], // will be set after initial Dns update query
      ...(isLeader() && {
        status: WEB_SERVICE_STATUS.HEALTHY, // will begin 'healthy'
        failover: null,
        failover_progress: null,
        failover_progress_history: null,
        failover_started: null,
        failover_finished: null,
      }),
    }
    this.initialize()
  }

  /* 
    Start of 'Member funtions'
  */

  /**
   * Handle poll 'success' case for each ip
   *
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  async pollSuccess(pollLogID: string, ipAddress: string) {
    if (pollLogID !== this.pollLogID) {
      return
    }

    const eachIPLogID = `${this.pollLogID}: ${ipAddress}:`
    try {
      logger.info(eachIPLogID, 'POLL-SUCCESS')
      const stats = this.getChecksDataByCurrentCaptainInstance()[ipAddress]!
      // logger.info(eachIPLogID, 'POLL-SUCCESS', 'STATS:BEFORE', stats)
      stats.last_update = new Date()
      let checkAndInitiateAddToActive = false
      if (stats.failing) {
        // we have status change now 'failing' to 'passing'
        logger.warn(eachIPLogID, 'POLL-SUCCESS', 'ALERT-STATUS-CHANGE', "'failing' to 'passing'", 'RESET STATS')
        // reset health check stats and try from zero again
        this.resetHealthCheckByIP(ipAddress)
        broadcastRequestForHealthCheck(this, HEALTH_CHECK_REQUEST_VERIFY_STATE.PASSING, ipAddress)
      } else if (stats.passing) {
        // no status change 'passing' before and 'passing' now
        if (stats.passing < this.rise) {
          stats.passing += 1
          if (stats.passing === this.rise) {
            // we reached 'rise' value
            logger.info(eachIPLogID, 'POLL-SUCCESS', 'ALERT-REACHED-RISE')
            checkAndInitiateAddToActive = true
          }
        } else {
          // don't bother with checks at and above 'rise', just keep checking
          // return to avoid broadcast
          return
        }
      } else {
        // both 'passing' and 'failing' are zero
        stats.passing += 1
      }
      broadcastHealthCheckUpdate(this, ipAddress)
      if (checkAndInitiateAddToActive && isLeader()) {
        await checkCombinedPeerStateAndInitiateAddActiveIP(this, ipAddress)
      }
    } catch (e) {
      logger.error(new Error(`${eachIPLogID}:POLL-SUCCESS`, {cause: e}))
    }
  }

  /**
   * Handle poll 'failed' case for each ip
   *
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  async pollFailed(pollLogID: string, ipAddress: string) {
    if (pollLogID !== this.pollLogID) {
      return
    }

    const eachIPLogID = `${this.pollLogID}: ${ipAddress}:`
    try {
      logger.info(eachIPLogID, 'POLL-FAILED')
      const stats = this.getChecksDataByCurrentCaptainInstance()[ipAddress]!
      // logger.info(eachIPLogID, 'POLL-FAILED', 'STATS:BEFORE', stats)
      stats.last_update = new Date()
      let checkAndInitiateRemoveFromActive = false
      if (stats.passing) {
        // we have status change now 'passing' to 'failing'
        logger.warn(eachIPLogID, 'POLL-FAILED', 'ALERT-STATUS-CHANGE', "'passing' to 'failing'", 'RESET STATS')
        // reset health check stats and try from zero again
        this.resetHealthCheckByIP(ipAddress)
        broadcastRequestForHealthCheck(this, HEALTH_CHECK_REQUEST_VERIFY_STATE.FAILING, ipAddress)
      } else if (stats.failing) {
        // no status change 'failing' before and 'failing' now
        if (stats.failing < this.fall) {
          stats.failing += 1
          if (stats.failing === this.fall) {
            // we reached 'fall' value
            logger.info(eachIPLogID, 'POLL-FAILED', 'ALERT-REACHED-FALL')
            checkAndInitiateRemoveFromActive = true
          }
        } else {
          // don't bother with checks at and above 'fall', just keep checking
          // return to avoid broadcast
          return
        }
      } else {
        // both 'passing' and 'failing' are zero
        stats.failing += 1
      }
      broadcastHealthCheckUpdate(this, ipAddress)
      if (checkAndInitiateRemoveFromActive && isLeader()) {
        await checkCombinedPeerStateAndInitiateRemoveActiveIP(this, ipAddress)
      }
    } catch (e) {
      logger.error(new Error(`${eachIPLogID}:POLL-FAILED`, {cause: e}))
    }
  }

  httpAgent = new http.Agent({
    keepAlive: false,
  })

  httpsAgent = new https.Agent({
    keepAlive: false,
  })

  /**
   * Poll each available addresses configured and handle 'success (200)'/'failure'
   *
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  async pollEachAddress(pollLogID: string, ipAddress: string) {
    const eachIPLogID = `${this.pollLogID}:POLLING:EACH:${ipAddress}:`
    try {
      const serviceConfCheck = this.serviceConf.check
      const ipUrl = `${serviceConfCheck.protocol}://${ipAddress}:${serviceConfCheck.port}${serviceConfCheck.path}`
      logger.debug(eachIPLogID, {
        ipAddress,
        ipUrl,
        host: serviceConfCheck.host,
      })
      const timeID = `${eachIPLogID}:${Date.now()}:request:timer`
      const startTime = Date.now()
      const timeOutParams = {
        // Needed for CONNECT_TIMEOUT - socket timeout
        connEstablished: false,
        // Needed for READ_TIMEOUT - response timeout
        responseFinished: false,
        // Several 'async/event' logical branches, process success/fail status.
        // eg: connTimeout, responseTimeout, normal response, error
        // use this to avoid duplicate processing.
        statusProcessed: false,
      }
      const request = (serviceConfCheck.protocol === 'https' ? https : http)
        .get(
          ipUrl,
          {
            // host override for 'https' to handle certificate issue
            ...(serviceConfCheck.protocol === 'https' ? {headers: {host: serviceConfCheck.host}} : {}),
            timeout: this.connectTimeout * 1000,
            // keelAlive is true in recent node, which is causing problems during polling.
            // https://github.com/nodejs/node/issues/47130
            // Using a custom agent to disable keepAlive
            agent: serviceConfCheck.protocol === 'https' ? this.httpsAgent : this.httpAgent,
          },
          async (res) => {
            timeOutParams.connEstablished = true
            logger.debug(`${timeID}:response:begin: Seconds: ${(Date.now() - startTime) / 1000}s`)
            setTimeout(async () => {
              // responseReadTimedOut processing
              if (!timeOutParams.responseFinished) {
                logger.info(`${timeID}:responseReadTimedOut: Seconds: ${(Date.now() - startTime) / 1000}s`)
                if (!timeOutParams.statusProcessed) {
                  timeOutParams.statusProcessed = true
                  await this.pollFailed(pollLogID, ipAddress)
                }
              }
            }, this.readTimeout * 1000)
            const statusCode = res.statusCode
            // Reading the response is essential to account for response time out
            const resBody = await readResponseBodyFromHealthCheck(res)
            timeOutParams.responseFinished = true
            logger.debug(eachIPLogID, {resBody})
            if (!timeOutParams.statusProcessed) {
              logger.debug(`${timeID}:response:status:${statusCode}: Seconds: ${(Date.now() - startTime) / 1000}s`)
              if (statusCode === 200) {
                timeOutParams.statusProcessed = true
                await this.pollSuccess(pollLogID, ipAddress)
              } else {
                timeOutParams.statusProcessed = true
                await this.pollFailed(pollLogID, ipAddress)
              }
            }
          }
        )
        .on('error', async (_e) => {
          logger.info(`${eachIPLogID}:error`, _e?.message || _e)
          if (!timeOutParams.statusProcessed) {
            timeOutParams.statusProcessed = true
            logger.info(`${timeID}:error: Seconds: ${(Date.now() - startTime) / 1000}s`)
            await this.pollFailed(pollLogID, ipAddress)
          }
        })
        .on('timeout', async () => {
          // connTimedOut processing
          if (!timeOutParams.connEstablished) {
            if (!timeOutParams.statusProcessed) {
              timeOutParams.statusProcessed = true
              logger.info(`${timeID}:connTimedOut: Seconds: ${(Date.now() - startTime) / 1000}s`)
              await this.pollFailed(pollLogID, ipAddress)
            }
          }
          request.destroy()
        })
    } catch (e) {
      logger.error(new Error(`${eachIPLogID}: Error in polling`, {cause: e}))
    }
  }

  /**
   * Simultaneously initiate 'polling' for all available addresses
   *
   * @memberof WebServiceManager
   */
  async pollAllAddresses(pollLogID: string) {
    try {
      const ipAddresses = this.serviceConf.addresses
      await Promise.all(
        ipAddresses.map((eachIPAddress: string) =>
          this.pollEachAddress(pollLogID, eachIPAddress).catch((e) => {
            logger.error(new Error(`${this.pollLogID}:POLLING:EACH:ip:${eachIPAddress}`, {cause: e}))
          })
        )
      )
    } catch (e) {
      logger.error(new Error(`${this.pollLogID}:POLLING:ALL`, {cause: e}))
    }
  }

  /**
   * Initiate/re-initiate web service address polling.
   * Can be called again to use as 'ReInitiate' polling
   *
   * @param {number} inputIntervalInMs
   * @memberof WebServiceManager
   */
  initiatePolling(inputIntervalInMs: number) {
    logger.info(`${this.logID}:initiatePolling:`, inputIntervalInMs)
    this._activePollID = `POLL_ID_${Date.now()}_${++this._initiatePollCounter}_every_${inputIntervalInMs}`
    // cleanup old poll timer
    if (this._pollLoopReference) {
      clearInterval(this._pollLoopReference)
    }

    // initiate new polling
    this._pollLoopReference = setInterval(() => {
      logger.debug(this.pollLogID, 'POLLING:ALL')
      this.pollAllAddresses(this.pollLogID)
    }, inputIntervalInMs)
  }

  /**
   * Sync addresses and initiate polling for failover
   */
  async initialize() {
    if (isLeader()) {
      await this.initialResolvedAndActiveAddressSync(this)
    }
    this.initiatePolling(this.healthyInterval * 1000)
  }

  /**
   * Set initial active_address(s) on startup. Called only by 'leader'.
   * During sync, give preference to 'resolved_addresses' ( live dns query )
   * DELETES!! any unknown zone record ip's that is not part of 'available addresses' from 'resolved_addresses' as per services.yaml
   */
  async initialResolvedAndActiveAddressSync(webService: WebServiceManager) {
    const resolvedAddresses: string[] = await dnsManager.resolvedAddresses(webService.serviceConf.zone_record)
    const availableAddresses = webService.serviceConf.addresses

    let newActiveAddresses: string[]
    if (webService.serviceConf.multi) {
      // multiple active_addresses addresses
      // add all available addresses to 'active_addresses' list
      newActiveAddresses = [...availableAddresses]
    } else {
      // single active address

      // Available addresses that is also an already 'resolved' address
      const availableResolvedAddresses = availableAddresses.filter((eachIpAddress) =>
        resolvedAddresses.includes(eachIpAddress)
      )
      logger.info('<===========initialResolvedAndActiveAddressSync============>', {
        availableResolvedAddresses,
      })
      if (availableResolvedAddresses?.[0]) {
        // add 'first' among the available addresses that is also a resolvedAddresss to 'active_addresses' list
        newActiveAddresses = [availableResolvedAddresses[0]!]
      } else {
        // add 'first' among the available addresses to 'active_addresses' list
        newActiveAddresses = [availableAddresses[0]!]
      }
    }
    this.handleActiveAddressChange(newActiveAddresses)
  }

  /**
   * Called only by leader.
   * Set 'active_addresses'.
   * Dns query to sync with live 'resolved_addresses'.
   * Broadcast to 'members'.
   * @param {string []} newActiveAddresses
   * @memberof WebServiceManager
   */
  public async handleActiveAddressChange(newActiveAddresses: string[]) {
    // Check isLeader
    if (isLeader()) {
      // set 'active_addresses'
      this.serviceState.active = newActiveAddresses

      // Begin the sync with live 'resolved_addresses'
      const resolvedAddresses: string[] = await dnsManager.resolvedAddresses(this.serviceConf.zone_record)
      // Availables ipaddress options as per configuration
      const knownAddresses = this.serviceConf.addresses
      const knownResolvedAddresses = resolvedAddresses.filter((eachIpAddress) => knownAddresses.includes(eachIpAddress))
      const unKnownResolvedAddresses = resolvedAddresses.filter(
        (eachIpAddress) => !knownAddresses.includes(eachIpAddress)
      )
      const addressesToBeAdded = newActiveAddresses.filter((eachIPAddres: string) => {
        return !knownResolvedAddresses.includes(eachIPAddres)
      })
      const addressesToBeDeleted = knownResolvedAddresses.filter((eachIPAddres: string) => {
        return !newActiveAddresses.includes(eachIPAddres)
      })
      logger.info('handleActiveAddressChange', {
        newActiveAddresses,
        resolvedAddresses,
        knownAddresses,
        knownResolvedAddresses,
        unKnownResolvedAddresses,
        addressesToBeAdded,
        addressesToBeDeleted,
      })
      // throw new Error('handleActiveAddressChange')

      if (addressesToBeAdded?.length) {
        await dnsManager.addZoneRecordMulti(this.serviceConf.zone_record, addressesToBeAdded)
      }
      if (addressesToBeDeleted?.length) {
        await dnsManager.removeZoneRecordMulti(this.serviceConf.zone_record, addressesToBeDeleted)
      }
      // Remove unknown addresses only if there is atleast a single valid active ipaddress
      if (newActiveAddresses?.length && unKnownResolvedAddresses?.length) {
        await dnsManager.removeZoneRecordMulti(this.serviceConf.zone_record, unKnownResolvedAddresses)
      }

      // Broadcast to 'members'
      broadcastActiveAddresses(this)
    } else {
      // Call the other method 'setActiveAddresses' from 'members' instance
      throw new Error('Only leader can sync resolved_addresses and broadcast active_addresses')
    }
  }

  /**
   * Called only by members. Set new active_addresses into 'serviceState'
   *
   * @param {string []} newActiveAddresses
   * @memberof WebServiceManager
   */
  public async setActiveAddresses(newActiveAddresses: string[]) {
    if (!isLeader()) {
      this.serviceState.active = newActiveAddresses
    } else {
      // Call the other method 'handleActiveAddressChange' from 'leader' instance
      throw new Error(
        'Leader needs to always accompany active_addresses change with "resolved_addresses" sync and broadcast to members'
      )
    }
  }

  /**
   * Reset 'health check stats' for the given ip
   * Reset stats only when health check is passive ( 'passing' >= 'rise' or 'failing' >= 'fall' )
   * Otherwise, active health check already being going on, so don't reset it
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  public resetHealthCheckByIP(ipAddress: string) {
    const stats = this.getChecksDataByCurrentCaptainInstance()[ipAddress]!
    stats.failing = 0
    stats.passing = 0
  }

  /**
   * Reset 'health check stats' to verify status change from 'failing' to 'passing' for the given ip address
   * a). Reset stats, when health check is in-active ( 'passing' >= 'rise' or 'failing' >= 'fall' )
   * b). Reset stats when health check is going 'failing'
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  public resetHealthCheckByIPToVerifyPassing(ipAddress: string) {
    const stats = this.getChecksDataByCurrentCaptainInstance()[ipAddress]!
    if (stats.passing >= this.rise || stats.failing >= this.fall) {
      this.resetHealthCheckByIP(ipAddress)
      logger.info(`${this.logID}: resetHealthCheckByIP: ${ipAddress}`, 'SUCCESS (reason: beyond "fall" or "rise")')
    } else if (stats.failing) {
      this.resetHealthCheckByIP(ipAddress)
      logger.info(
        `${this.logID}: resetHealthCheckByIP: ${ipAddress}`,
        'SUCCESS (reason: change in "failing" to "passing")'
      )
    } else {
      logger.info(`${this.logID}: resetHealthCheckByIP: ${ipAddress}`, 'IGNORED', stats)
    }
  }

  /**
   * Reset 'health check stats' to verify status change from 'passing' to 'failing' for the given ip address
   * a). Reset stats, when health check is in-active ( 'passing' >= 'rise' or 'failing' >= 'fall' )
   * b). Reset stats when health check is going 'passing'
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  public resetHealthCheckByIPToVerifyFailing(ipAddress: string) {
    const stats = this.getChecksDataByCurrentCaptainInstance()[ipAddress]!
    if (stats.passing >= this.rise || stats.failing >= this.fall) {
      this.resetHealthCheckByIP(ipAddress)
      logger.info(`${this.logID}: resetHealthCheckByIP: ${ipAddress}`, 'SUCCESS (reason: beyond "fall" or "rise")')
    } else if (stats.passing) {
      this.resetHealthCheckByIP(ipAddress)
      logger.info(
        `${this.logID}: resetHealthCheckByIP: ${ipAddress}`,
        'SUCCESS (reason: change in "passing" to "failing")'
      )
    } else {
      logger.info(`${this.logID}: resetHealthCheckByIP: ${ipAddress}`, 'IGNORED', stats)
    }
  }

  /**
   * Reset 'health check stats' for the all ips of this service
   *
   * @memberof WebServiceManager
   */
  public resetAllHealthCheck() {
    for (const eachIPAddres of this.serviceConf.addresses) {
      this.resetHealthCheckByIP(eachIPAddres)
    }
  }

  public isHealthy() {
    return this.serviceState.status === WEB_SERVICE_STATUS.HEALTHY
  }

  /**
   * Reset health check for all ip's and initiate polling using 'health_interval'
   *
   * @memberof WebServiceManager
   */
  public markHealthy() {
    this.serviceState.status = WEB_SERVICE_STATUS.HEALTHY
    this.resetAllHealthCheck()
    this.initiatePolling(this.healthyInterval * 1000)
    if (isLeader()) {
      // Only leader maintains the web service 'status' ('healthy' OR 'unhealthy').
      // Since the polling need to use 'healthy_interval' or 'unhealthy_interval' based on health 'status',
      // leader communicates the polling frequency required via this 'broadcast' to non-leader members
      broadcastResetPolling(this, RESET_POLLING_REQUEST_POLLING_TYPE.HEALTHY)
    }
  }

  /**
   * Reset health check for all ip's and initiate polling using 'un_health_interval'
   *
   * @memberof WebServiceManager
   */
  public markUnHealthy() {
    this.serviceState.status = WEB_SERVICE_STATUS.UN_HEALTHY
    this.resetAllHealthCheck()
    this.initiatePolling(this.unhealthyInterval * 1000)
    if (isLeader()) {
      // Only leader maintains the web service 'status' ('healthy' OR 'unhealthy').
      // Since the polling need to use 'healthy_interval' or 'unhealthy_interval' based on health 'status',
      // leader communicates the polling frequency required via this 'broadcast' to non-leader members
      broadcastResetPolling(this, RESET_POLLING_REQUEST_POLLING_TYPE.UN_HEALTHY)
    }
  }

  public isFailOverInProgress() {
    return (
      this.serviceState.failover_progress &&
      this.serviceState.failover_progress !== FAILOVER_PROGRESS.FAILOVER_COMPLETED &&
      this.serviceState.failover_progress !== FAILOVER_PROGRESS.FAILOVER_FAILED
    )
  }

  private resetPastFailOverProgressData() {
    this.serviceState.failover_progress = null
    this.serviceState.failover_progress_date_time = null
    this.serviceState.failover_progress_history = null
    this.serviceState.failover_started = null
    this.serviceState.failover_finished = null
  }

  /**
   * Cleanup old failover data and begin a new one.
   * Uses setTimeout to handle failover cool_down
   * @memberof WebServiceManager
   */
  public beginFailOverProcess(oldIpAddress: string) {
    logger.info(this.logID, '<===============================================>')
    logger.info(this.logID, '<===============================================>')
    logger.info(this.logID, 'FAILOVER_COOLDOWN Started:1')
    logger.info(this.logID, '<===============================================>')
    logger.info(this.logID, '<===============================================>')
    this.resetPastFailOverProgressData()
    const currentDate = new Date()
    this.serviceState.failover_progress = FAILOVER_PROGRESS.FAILOVER_STARTED
    this.serviceState.failover_progress_date_time = currentDate
    this.serviceState.failover_progress_history = null
    this.serviceState.failover_started = currentDate

    // cleanup old cooldown timeout
    if (this._failOverCoolDownLoopReference) {
      clearTimeout(this._failOverCoolDownLoopReference)
    }

    // initiate new cooldown timeout
    logger.info(this.logID, '<===============================================>')
    logger.info(this.logID, '<===============================================>')
    logger.info(this.logID, 'FAILOVER_COOLDOWN Started:2')
    logger.info(this.logID, '<===============================================>')
    logger.info(this.logID, '<===============================================>')
    this._failOverCoolDownLoopReference = setTimeout(async () => {
      logger.info(this.logID, '<===============================================>')
      logger.info(this.logID, '<===============================================>')
      logger.info(this.logID, 'FAILOVER_COOLDOWN Over')
      logger.info(this.logID, '<===============================================>')
      logger.info(this.logID, '<===============================================>')
      if (this.serviceState.failover_progress === FAILOVER_PROGRESS.DNS_UPDATED) {
        if (this.serviceState.active[0] && verifyPassingAggreement(this, this.serviceState.active[0])) {
          await notifyFailOverSucceeded(this, oldIpAddress, this.serviceState.active[0])
          this.updateFailOverProgress(FAILOVER_PROGRESS.FAILOVER_COMPLETED)
          this.markHealthy()
        } else {
          await notifyFailOverFailed(
            this,
            oldIpAddress,
            this.serviceState.active[0],
            "Failover target not in 'passing' state, after cool down"
          )
          this.updateFailOverProgress(FAILOVER_PROGRESS.FAILOVER_FAILED)
          this.markUnHealthy()
        }
      } else {
        await notifyFailOverFailed(this, oldIpAddress, undefined, "Couldn't find a healthy target for failover")
        this.updateFailOverProgress(FAILOVER_PROGRESS.FAILOVER_FAILED)
        this.markUnHealthy()
      }
      // this.cleanUpPastFailOverProgressData()
      // notifyFailOverSucceeded(webService, ipAddress, failOverIPAddress)
      // notifyFailOverFailed(webService, ipAddress, "Couldn't find a healthy target for failover")
    }, this.coolDown * 1000)
  }

  /**
   * Update step by step failover progress.
   * ( Except 'start'. Use 'beginFailOverProgress' for it )
   * @param {FAILOVER_PROGRESS} newStatus
   * @memberof WebServiceManager
   */
  public updateFailOverProgress(newStatus: FAILOVER_PROGRESS) {
    // If there is an existing failover_progress, push into history for tracking
    if (this.serviceState.failover_progress) {
      this.serviceState.failover_progress_history = this.serviceState.failover_progress_history || []
      this.serviceState.failover_progress_history.push({
        failover_progress: this.serviceState.failover_progress!,
        failover_progress_date_time: this.serviceState.failover_progress_date_time!,
      })
    }
    this.serviceState.failover_progress = newStatus
    this.serviceState.failover_progress_date_time = new Date()
  }

  public getServiceDataForReporting() {
    return this.serviceState
  }
  /* 
    End of 'Member funtions'
  */
}
