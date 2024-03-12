import http from 'http'
import https from 'https'
import appConfig from './appConfig.js'
import {logger, readResponseBodyFromHealthCheck} from './coreUtils.js'
import appState from './appState.js'

export type typeWebServiceConf = {
  name: string
  description: string
  tags: Array<string>
  zone_record: string
  addresses: Array<string>
  multi: boolean
  check: {
    protocol: string
    host: string
    port: number
    path: string
  }
  mate: {
    addresses: Array<string>,
    path: string
  }
  unhealthy_interval: number
  healthy_interval: number
  fall: number
  rise: number
  connect_timeout: number
  read_timeout: number
  cool_down: number
}

export enum PASS_FAIL_IP_STATES {
  STATE_UNKNOWN = 'STATE_UNKNOWN',
  STATE_UP = 'STATE_UP',
  STATE_DOWN = 'STATE_DOWN',
}

export type ipPassFailState = {
  state: PASS_FAIL_IP_STATES
  last_update: Date | null
}

export type typeWebServiceState = {
  // service: typeWebServiceConf,
  is_remote: boolean
  is_orphan: boolean
  checks: {
    [ipAddress: string]: ipPassFailState
  }
  active: Array<string>
  status?: WEB_SERVICE_STATUS  
}

export const enum WEB_SERVICE_STATUS {
  STATUS_NOT_SET = 'unknown',
  HEALTHY = 'healthy',
  UN_HEALTHY = 'unhealthy',
}

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
  _pollLoopReference?: any
  _activePollID!: string

  _failOverCoolDownLoopReference: any

  /* 
    Start of 'Basic getters and setters'
  */

  /**
   * Unique identifier for each web service,
   * used to uniquely identify the service across the whole system ( captain peers, mates etc...)
   * Using YAML 'name' key of the service as serviceKey
   */
  public get serviceKey() {
    return this.serviceConf.name
  }

  get pollingInterval(): number {
    logger.info('appConfig.INTERVAL', appConfig.INTERVAL)
    return appConfig.INTERVAL
  }

  get connectTimeout() {
    return this.serviceConf.connect_timeout || appConfig.DEFAULT_CONNECT_TIMEOUT
  }

  get readTimeout() {
    return this.serviceConf.read_timeout || appConfig.DEFAULT_READ_TIMEOUT
  }

  get logID() {
    return `SERVICE: ${this.serviceConf.name}(${this.serviceConf.zone_record}):`
  }

  get pollLogID() {
    return `${this.logID} ${this._activePollID}:`
  }


  /**
   * Get 'PassFailState' for given ip address
   *
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  public getChecksDataForGivenIP(ipAddress: string): ipPassFailState {
    return this.serviceState.checks![ipAddress]!
  }

  /**
   *  Set 'PassFailState' for given ip address
   *
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  public setStateForGivenIP(ipAddress: string, currentIPState: PASS_FAIL_IP_STATES) {
    // logger.info('setStateForGivenIP:pre', this.serviceState.checks)
    this.serviceState.checks[ipAddress] = {
      state: currentIPState,
      last_update: new Date()
    }
    logger.debug('setStateForGivenIP', this.serviceState.checks[ipAddress])
  }

  /* 
    End of 'Basic getters and setters'
  */

  private constructor(serviceConf: typeWebServiceConf) {

    const currentDateTime = new Date()
    this.serviceConf = serviceConf
    this.serviceState = {
      is_remote: true,
      is_orphan: false,
      checks: serviceConf.mate.addresses.reduce(
        (accumulator, eachAddress: string) => {
          accumulator[eachAddress] = {
            state: PASS_FAIL_IP_STATES.STATE_UNKNOWN,
            last_update: currentDateTime,
          }
          return accumulator
        },
        {} as {
          [ipAddress: string]: ipPassFailState
        }
      ),
      active: [], // will be set after initial Dns update query
    }
    logger.debug(this.serviceConf)
  }

  // Factory to create webservice
  public static async createWebService(serviceConf: typeWebServiceConf) {
    const webService = new WebServiceManager(serviceConf)
    await webService.initialize()
    return webService
  }

  /* 
    Start of 'Member funtions'
  */

  public getAddressesCountForBulkPolling() {
    // 5 or half of all addresses, whichever is lower
    const noOfAddressesToBeScanned = Math.max(1, Math.min(3, Math.floor(this.serviceConf.mate.addresses.length / 2) + 1))
    return noOfAddressesToBeScanned    
  }

  /**
   * Get UP/DOWN state of adjacent ips in the list of mate ipaddresses,
   * for extra UP/DOWN confirmation of the service
   * @param {string} pollLogID
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  public async pollAndGetStateOfAdjacentIps(pollLogID: string, ipAddress: string) {
    // 5 or half of all addresses, whichever is lower
    const noOfAddressesToBeScanned = this.getAddressesCountForBulkPolling()
    const nextSetOfAddresses = this.getAddressesToBePolled(pollLogID, noOfAddressesToBeScanned, false).filter(
      (eachIp) => eachIp !== ipAddress
    )
    let noOfUps = 0
    let noOfDowns = 0
    // Poll all selected address for UP/DOWN state and update the checks state and also increment the counters
    await Promise.all(nextSetOfAddresses.map((eachIP) => {
      return this.pollEachAddress(
        pollLogID,
        eachIP,
        () => {
          noOfUps += 1
          this.setStateForGivenIP(eachIP, PASS_FAIL_IP_STATES.STATE_UP)
        },
        () => {
          noOfDowns += 1
          this.setStateForGivenIP(eachIP, PASS_FAIL_IP_STATES.STATE_DOWN)
        }
      )
    }))
    logger.debug('getStateOfAdjacentIps', {
      ipAddress,
      nextSetOfAddresses,
      noOfAddressesToBeScanned,
      noOfUps,
      noOfDowns,
    })
    return {
      noOfUps,
      noOfDowns
    }
  }

  /**
   * Handle poll 'success' case for each ip
   *
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  public async pollSuccessRoundRobin(pollLogID: string, ipAddress: string) {
    // polling has been reset
    if (pollLogID !== this.pollLogID) {
      return
    }
  
    const eachIPLogID = `${this.pollLogID}: ${ipAddress}:`
    try {
      logger.debug(eachIPLogID, 'POLL-SUCCESS')
      // const oldStates = {...this.serviceState.checks}
      const oldStateForIP = { ...this.getChecksDataForGivenIP(ipAddress) }
      const oldWebServiceStatus = this.serviceState.status
      this.setStateForGivenIP(ipAddress, PASS_FAIL_IP_STATES.STATE_UP)
      // Since one ip is enough procliam a service as up, we proclaim no change in state only when
      // a). Service is already healthy
      // b). Individual ip state is already up
      // Else, we do whole status recheck and send "SERVICE_STATE_CHANGE" if needed
      if (oldWebServiceStatus === WEB_SERVICE_STATUS.HEALTHY && oldStateForIP.state === PASS_FAIL_IP_STATES.STATE_UP) {
        // (STATE_UP) No change in state
        logger.debug(eachIPLogID, 'POLL-SUCCESS', 'No change in state', {
          oldStateForIP,
          oldWebServiceStatus
        })
      } else {
        // oldStateForIP.state was STATE_UNKNOWN (OR) STATE_DOWN
        if (this.serviceState.status === WEB_SERVICE_STATUS.HEALTHY) {
          // Service already "HEALTHY", so ip address "passing" can be ignored
          logger.info(eachIPLogID, 'POLL-SUCCESS', 'Service already "HEALTHY", so ip address "passing" can be ignored')
        } else {
          logger.warn(eachIPLogID, 'POLL-SUCCESS', 'ALERT-POSSIBLE-SERVICE-STATUS-CHANGE')
          // a). Do additional health check and decide on "SERVICE_STATE_CHANGE" message to captain
          // b). As for 'POLL-SUCCESS' case, since one ip is enough for marking a service 'HEALTHY',
          // additional checks optional but done anyway here.
          logger.debug(eachIPLogID, 'POLL-SUCCESS', 'Do additional health check and decide on "SERVICE_STATE_CHANGE" message')
          const stateOfIps = await this.pollAndGetStateOfAdjacentIps(pollLogID, ipAddress)
          stateOfIps.noOfUps += 1 //POLL-SUCCESS for the current ip
          const isServiceHealthyNow = stateOfIps.noOfUps > 0
          // logger.info(eachIPLogID, 'post-checks', {
          //   oldStates,
          //   oldStateForIP,
          //   currentStates: this.serviceState.checks,
          //   currentStateForIP: this.getChecksDataForGivenIP(ipAddress),
          //   stateOfIps,
          //   oldWebServiceStatus,
          //   isServiceHealthyNow
          // })
          if (oldWebServiceStatus === WEB_SERVICE_STATUS.UN_HEALTHY) {
            if (isServiceHealthyNow) {
              // Old state WEB_SERVICE_STATUS.UN_HEALTHY
              // Current state WEB_SERVICE_STATUS.HEALTHY
              // Change from UN_HEALTHY to HEALTHY, so emit 'SERVICE_STATE_CHANGE'                          
              logger.warn(eachIPLogID, 'POLL-SUCCESS', 'ALERT-CONFIRMED-SERVICE-STATUS-CHANGE', 'UN_HEALTHY to HEALTHY')
              this.markHealthy()
              appState.getSocketManager().sendServiceStateChangeMessage(this, stateOfIps.noOfUps)
            }
          } else if(!oldWebServiceStatus || oldWebServiceStatus === WEB_SERVICE_STATUS.STATUS_NOT_SET) {
            // Service status "STATUS_NOT_SET", service just started and in that case,
            // captain already does the initial health checks, so "SERVICE_STATE_CHANGE" message not needed
            // just mark healthy or unhealthy
            logger.debug(eachIPLogID, 'POLL-SUCCESS', 'Service status was "STATUS_NOT_SET", service just started and in that case, captain already does the initial health checks, so "SERVICE_STATE_CHANGE" message not needed')
            isServiceHealthyNow ? this.markHealthy() : this.markUnHealthy()
          }
        }        
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
  public async pollFailedRoundRobin(pollLogID: string, ipAddress: string) {
    // polling has been reset
    if (pollLogID !== this.pollLogID) {
      return
    }

    const eachIPLogID = `${this.pollLogID}: ${ipAddress}:`
    try {
      logger.debug(eachIPLogID, 'POLL-FAILED')
      // const oldStates = {...this.serviceState.checks}
      const oldStateForIP = { ...this.getChecksDataForGivenIP(ipAddress) }
      const oldWebServiceStatus = this.serviceState.status
      this.setStateForGivenIP(ipAddress, PASS_FAIL_IP_STATES.STATE_DOWN)
      if (oldStateForIP.state === PASS_FAIL_IP_STATES.STATE_DOWN) {
        // (STATE_DOWN) No change in state
        logger.debug(eachIPLogID, 'POLL-FAILED', 'No change in state' , {
          oldStateForIP,
          oldWebServiceStatus
        })
      } else {
        // STATE_UNKNOWN (OR) STATE_UP
        if (this.serviceState.status === WEB_SERVICE_STATUS.UN_HEALTHY) {
          // Service already "UN_HEALTHY", so ip address "failing" can be ignored
          logger.debug(eachIPLogID, 'POLL-FAILED', 'Service already "UN_HEALTHY", so ip address "failing" can be ignored')
        } else {
          logger.warn(eachIPLogID, 'POLL-FAILED', 'ALERT-POSSIBLE-SERVICE-STATUS-CHANGE')
          // Do additional health check and decide on "SERVICE_STATE_CHANGE" message to captain
          logger.debug(eachIPLogID, 'POLL-FAILED', 'Do additional health check and decide on "SERVICE_STATE_CHANGE" message')
          const stateOfIps = await this.pollAndGetStateOfAdjacentIps(pollLogID, ipAddress)
          stateOfIps.noOfDowns += 1 //POLL-FAILED for the current ip
          const isServiceHealthyNow = stateOfIps.noOfUps > 0
          // logger.info(eachIPLogID, 'post-checks', {
          //   oldStates,
          //   oldStateForIP,
          //   currentStates: this.serviceState.checks,
          //   currentStateForIP: this.getChecksDataForGivenIP(ipAddress),
          //   stateOfIps,
          //   oldWebServiceStatus,
          //   isServiceHealthyNow
          // })
          if (oldWebServiceStatus === WEB_SERVICE_STATUS.HEALTHY) {
            if (!isServiceHealthyNow) {
              // Old state WEB_SERVICE_STATUS.HEALTHY
              // Current state WEB_SERVICE_STATUS.UN_HEALTHY
              // Change from HEALTHY to UN_HEALTHY , so emit 'SERVICE_STATE_CHANGE'                          
              logger.warn(eachIPLogID, 'POLL-FAILED', 'ALERT-CONFIRMED-SERVICE-STATUS-CHANGE', 'HEALTHY to UN_HEALTHY')
              this.markUnHealthy()
              appState.getSocketManager().sendServiceStateChangeMessage(this, stateOfIps.noOfUps)
            }
          } else if (!oldWebServiceStatus || oldWebServiceStatus === WEB_SERVICE_STATUS.STATUS_NOT_SET) {
            // Service status "STATUS_NOT_SET", service just started and in that case,
            // captain already does the initial health checks, so 'SERVICE_STATE_CHANGE' message not needed
            // just mark healthy or unhealthy
            logger.debug(eachIPLogID, 'POLL-FAILED', 'Service status was "STATUS_NOT_SET", service just started and in that case, captain already does the initial health checks, so "SERVICE_STATE_CHANGE" message not needed')
            isServiceHealthyNow ? this.markHealthy() : this.markUnHealthy()
          }
        }        
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
  async pollEachAddress(pollLogID: string, ipAddress: string, successCallBack: Function, failureCallBack: Function) {
    return new Promise<void>((resolve) => {
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
                  logger.debug(`${timeID}:responseReadTimedOut: Seconds: ${(Date.now() - startTime) / 1000}s`)
                  if (!timeOutParams.statusProcessed) {
                    timeOutParams.statusProcessed = true
                    await failureCallBack(pollLogID, ipAddress)
                    return resolve();
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
                  await successCallBack(pollLogID, ipAddress)
                  return resolve();
                } else {
                  timeOutParams.statusProcessed = true
                  await failureCallBack(pollLogID, ipAddress)
                  return resolve();
                }
              }
            }
          )
          .on('error', async (_e) => {
            logger.debug(`${eachIPLogID}:error`, _e?.message || _e)
            if (!timeOutParams.statusProcessed) {
              timeOutParams.statusProcessed = true
              logger.debug(`${timeID}:error: Seconds: ${(Date.now() - startTime) / 1000}s`)
              await failureCallBack(pollLogID, ipAddress)
              return resolve();
            }
          })
          .on('timeout', async () => {
            // connTimedOut processing
            if (!timeOutParams.connEstablished) {
              if (!timeOutParams.statusProcessed) {
                timeOutParams.statusProcessed = true
                logger.debug(`${timeID}:connTimedOut: Seconds: ${(Date.now() - startTime) / 1000}s`)
                await failureCallBack(pollLogID, ipAddress)
                return resolve();
              }
            }
            request.destroy()
          })
      } catch (e) {
        logger.error(new Error(`${eachIPLogID}: Error in polling`, {cause: e}))
        return resolve();
      }  
    })
  }

  // Track polled addresses on each iteration as only subset of addresses polled
  lastPollingState?: {
    lastPolledAddressIndex: number
    pollLogID: string
  }

  
  /**
   *  Algorithm to choose the addresses
   *
   * @param {string} pollLogID
   * @param {number} noOfAddresses
   * @param {boolean} [updateState=true] // Update current iteration in a state variable, so that next set of addresses will be choosen next time
   * @memberof WebServiceManager
   */
  getAddressesToBePolled(pollLogID: string, noOfAddresses: number, updateState: boolean = true) {
    // Make sure to reset, in case, polling is reset ( based on different pollLogID )
    if (this.lastPollingState?.pollLogID && this.lastPollingState.pollLogID !== pollLogID) {
      this.lastPollingState = undefined
    }
    const allAddresses = this.serviceConf.mate.addresses
    // 5 or half of all addresses, whichever is lower
    let startIndex = this.lastPollingState?.lastPolledAddressIndex || 0
    // Start from zero if all addresses polled
    if (startIndex >= allAddresses.length) {
      startIndex = 0
    }
    let endIndex = startIndex + noOfAddresses
    const selectedAddresses = allAddresses.slice(startIndex, endIndex)
    const pendingNoOfAddresses = noOfAddresses - selectedAddresses.length
    // logger.info('getAddressesToBePolled:set:1', {
    //   selectedAddresses,
    //   startIndex,
    //   endIndex
    // })
    // We will have 'pendingNoOfAddresses' when at the edge of the array.
    // In that case, move to first to fetch addresses again
    if (pendingNoOfAddresses && startIndex !== 0) {
      endIndex = Math.min(pendingNoOfAddresses, startIndex) // end index can't be greater than last 'startIndex' else we will get duplicates
      startIndex = 0
      const additionalAddresses = allAddresses.slice(startIndex, endIndex)
      // logger.info('getAddressesToBePolled:set:2', {
      //   additionalAddresses,
      //   startIndex,
      //   endIndex
      // })
      selectedAddresses.push(...additionalAddresses)
    }
    // logger.info('getAddressesToBePolled:set:3', selectedAddresses)
    if (updateState) {
      this.lastPollingState = {
        lastPolledAddressIndex: endIndex,
        pollLogID,
      }  
    }
    // logger.info('getAddressesToBePolled', {
    //   noOfAddresses,
    //   startIndex,
    //   endIndex,
    //   selectedAddresses,
    // })
    return selectedAddresses
  }

  /**
   * Since a service could have lot of private ips bound to it, we poll in round robin
   *
   * @memberof WebServiceManager
   */
  async pollAddressesInRoundRobin(pollLogID: string) {
    let raceCondLock
    try {
      //need to use 'pollLogID' which already has service name/id in it.
      raceCondLock = await appState.getRaceHandler().getLock(`pollAddressesInRoundRobin:${pollLogID}`)
      const ipAddresses = this.getAddressesToBePolled(pollLogID, 1)! // one at a time in 'INTERVAL' normally
      await Promise.all(
        ipAddresses.map((eachIPAddress: string) =>
          this.pollEachAddress(
            pollLogID,
            eachIPAddress,
            // using closure for pollSuccessRoundRobin and pollFailedRoundRobin to preserve 'this'
            (pollLogID: string, ipAddress: string) => this.pollSuccessRoundRobin(pollLogID, ipAddress),
            (pollLogID: string, ipAddress: string) => this.pollFailedRoundRobin(pollLogID, ipAddress)
          ).catch((e) => {
            logger.error(new Error(`${this.pollLogID}:POLLING:EACH:ip:${eachIPAddress}`, {cause: e}))
          })
        )
      )
    } catch (e) {
      logger.error(new Error(`${this.pollLogID}:POLLING:ALL`, {cause: e}))
    } finally {
      appState.getRaceHandler().releaseLock(raceCondLock)
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
      this.pollAddressesInRoundRobin(this.pollLogID)
    }, inputIntervalInMs)
  }

  /**
   * Sync addresses and initiate polling for failover
   */
  async initialize() {
    this.initiatePolling(this.pollingInterval * 1000)
  }

  /**
   * Reset health check for all ip's and initiate polling using 'health_interval'
   *
   * @memberof WebServiceManager
   */
  public markHealthy() {
    this.serviceState.status = WEB_SERVICE_STATUS.HEALTHY    
  }

  /**
   * Reset health check for all ip's and initiate polling using 'un_health_interval'
   *
   * @memberof WebServiceManager
   */
  public markUnHealthy() {
    this.serviceState.status = WEB_SERVICE_STATUS.UN_HEALTHY    
  }

  public getServiceDataForAPI() {
    return this.serviceState
  }

  public toString() {
    return `${this.logID}:${JSON.stringify(this.serviceKey)}`
  }

  public cleanUpForDeletion() {
    if (this._pollLoopReference) {
      clearInterval(this._pollLoopReference)
    }
    if (this._failOverCoolDownLoopReference) {
      clearTimeout(this._failOverCoolDownLoopReference)
    }
  }
  /* 
    End of 'Member funtions'
  */
}
