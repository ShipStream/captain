import appConfig from '../appConfig.js';
import { isLeader, webServices } from '../appState.js';
import { broadcastHealthCheckUpdate } from '../socket/captainSocketServerManager.js';
import { checkCombinedPeerStateAndInitiateAddActiveIP, checkCombinedPeerStateAndInitiateRemoveActiveIP, setInitialActiveAddressesForWebService, typeWebServiceConf, typeWebServiceState } from './webServiceHelper.js';
import http from 'http';
import https from 'https';


/**
 * Maintains state and handles 'polling' for each service
 *
 * @class WebServiceManager
 */
export class WebServiceManager {
  serviceState: typeWebServiceState

  _initiatePollCounter = 0
  _pollLoopReference: any
  _activePollID!: string

  
  /**
   * Using 'zone_record' as serviceKey, maybe use 'name' ?
   */
  get serviceKey() {
    return this.serviceState.service.zone_record
  }

  get unhealthyInterval() {
    return this.serviceState.service.unhealthy_interval || appConfig.DEFAULT_HEALTHY_INTERVAL
  }
  get healthyInterval() {
    return this.serviceState.service.healthy_interval || appConfig.DEFAULT_UNHEALTHY_INTERVAL
  }
  get fall() {
    return this.serviceState.service.fall || appConfig.DEFAULT_FALL
  }
  get rise() {
    return this.serviceState.service.rise || appConfig.DEFAULT_RISE
  }
  get connectTimeout() {
    return this.serviceState.service.connect_timeout || appConfig.DEFAULT_CONNECT_TIMEOUT
  }
  get readTimeout() {
    return this.serviceState.service.read_timeout || appConfig.DEFAULT_READ_TIMEOUT
  }
  get coolDown() {
    return this.serviceState.service.cool_down || appConfig.DEFAULT_COOL_DOWN
  }

  get logID() {
    return `SERVICE: ${this.serviceState.service.name}(${this.serviceState.service.zone_record}):`;
  }

  get pollLogID() {
    return `${this.logID} ${this._activePollID}:`;
  }

  get statsForCurrentCaptain() {
    return this.serviceState.checks[appConfig.SELF_URL]!
  }

  /**
   * Handle poll 'success' case for each ip
   *
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  async pollSuccess(ipAddress: string) {
    const eachIPLogID = `${this.pollLogID}: ${ipAddress}:`
    const stats = this.statsForCurrentCaptain[ipAddress]!;
    // console.log(eachIPLogID, 'POLL-SUCCESS', 'STATS:BEFORE', stats)
    stats.last_update = new Date()
    let checkAndInitiateAddToActive = false
    if (stats.failing) {
      // we have status change now 'failing' to 'passing'
      console.log(eachIPLogID, 'POLL-SUCCESS', 'ALERT-STATUS-CHANGE', "'failing' to 'passing'", 'RESET STATS')
      // reset stats and try from zero again
      stats.failing = 0
      stats.passing = 0
    } else if (stats.passing) {
      // no status change 'passing' before and 'passing' now
      if (stats.passing < this.rise) {
        stats.passing += 1
        if (stats.passing === this.rise) {
          // we reached 'rise' value
          console.log(eachIPLogID, 'POLL-SUCCESS', 'ALERT-REACHED-RISE')
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
    if (checkAndInitiateAddToActive) {
      checkCombinedPeerStateAndInitiateAddActiveIP(this, ipAddress)
    }
  }

  /**
   * Handle poll 'failed' case for each ip
   *
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  async pollFailed(ipAddress: string) {
    const eachIPLogID = `${this.pollLogID}: ${ipAddress}:`
    const stats = this.statsForCurrentCaptain[ipAddress]!;
    // console.log(eachIPLogID, 'POLL-FAILED', 'STATS:BEFORE', JSON.stringify(stats))
    stats.last_update = new Date()
    let checkAndInitiateRemoveFromActive = false
    if (stats.passing) {
      // we have status change now 'passing' to 'failing'
      console.log(eachIPLogID, 'POLL-FAILED', 'ALERT-STATUS-CHANGE', "'passing' to 'failing'", 'RESET STATS')
      // reset stats and try from zero again
      stats.failing = 0
      stats.passing = 0
    } else if (stats.failing) {
      // no status change 'failing' before and 'failing' now
      if (stats.failing < this.fall) {
        stats.failing += 1
        if (stats.failing === this.fall) {
          // we reached 'fall' value
          console.log(eachIPLogID, 'POLL-FAILED', 'ALERT-REACHED-FALL')
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
    if (checkAndInitiateRemoveFromActive) {
      checkCombinedPeerStateAndInitiateRemoveActiveIP(this, ipAddress)
    }
  }


  /**
   * Poll each available addresses configured and handle 'success (200)'/'failure'
   *
   * @param {string} ipAddress
   * @memberof WebServiceManager
   */
  async pollEachAddress(ipAddress: string) {
    const eachIPLogID = `${this.pollLogID}: ${ipAddress}:`

    const serviceConfCheck = this.serviceState.service.check
    const ipUrl = `${serviceConfCheck.protocol}://${ipAddress}:${serviceConfCheck.port}${serviceConfCheck.path}`
    console.log(eachIPLogID, 'POLLING:EACH', JSON.stringify({
      ipAddress,
      ipUrl,
      host: serviceConfCheck.host,
    }));
    const request = (serviceConfCheck.protocol === 'https' ? https : http).get(ipUrl, {
      // host override for 'https' to handle certificate issue
      ... (serviceConfCheck.protocol === 'https' ? { headers: { host: serviceConfCheck.host } } : {}),
      timeout: this.connectTimeout * 1000,
    }, async (res) => {
      const statusCode = res.statusCode;
      // const resBody = await readResponseBodyFromHealthCheck(res)
      if (statusCode == 200) {
        await this.pollSuccess(ipAddress)
      } else {
        await this.pollFailed(ipAddress)
      }
    }).on('error', async (e) => {
      // console.log(e)
      await this.pollFailed(ipAddress)
    }).on('timeout', async () => {
      request.destroy()
    });
  }


  /**
   * Simultaneously initiate 'polling' all available addresses
   *
   * @memberof WebServiceManager
   */
  async pollAllAddresses() {
    try {
      const ipAddresses = this.serviceState.service.addresses
      await Promise.all(ipAddresses.map((eachIPAddress: string) => this.pollEachAddress(eachIPAddress).catch((e) => {
        console.log(this.pollLogID, 'POLLING:EACH', eachIPAddress, e)
      })))
    } catch (e) {
      console.log(this.pollLogID, 'POLLING:ALL', e)
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
    this._activePollID = `POLL_ID_${++this._initiatePollCounter}_every_${inputIntervalInMs}`
    // cleanup old poll timer
    if (this._pollLoopReference) {
      clearInterval(this._pollLoopReference)
    }

    // initiate new polling
    this._pollLoopReference = setInterval(() => {
      console.log(this.pollLogID, 'POLLING:ALL',)
      this.pollAllAddresses()
    }, inputIntervalInMs)
  }

  constructor(serviceConf: typeWebServiceConf) {
    this.serviceState = {
      service: serviceConf,
      is_remote: false,
      is_orphan: false,
      mates: null,
      checks: {
        [appConfig.SELF_URL]: serviceConf.addresses.reduce((accumulator: any, eachAddress: string) => {
          accumulator[eachAddress] = {
            failing: 0,
            passing: 0,
            last_update: null,
          }
          return accumulator
        }, {})
      },
      active: [], // will be set after initial Dns update query
      status: "healthy", // will begin 'healthy'
      failover: null,
      failover_started: null,
      failover_finished: null
    }
    if (isLeader()) {
      setInitialActiveAddressesForWebService(this)
    }
    this.initiatePolling(this.healthyInterval * 1000)
  };
}
