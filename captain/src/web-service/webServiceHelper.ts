/* eslint-disable no-unused-vars */
/* eslint-disable camelcase */
import fs from 'fs/promises'
import http from 'http'
import YAML from 'yaml'
import {WebServiceManager} from './webServiceManager.js'
import appState from '../appState.js'
import appConfig from '../appConfig.js'
import {logger} from './../coreUtils.js'
import { existsSync } from 'fs'

export const enum HEALTH_CHECK_REQUEST_VERIFY_STATE {
  PASSING = 'passing',
  FAILING = 'failing',
  NONE = 'none',
}

export const enum CHANGE_POLLING_FREQ_POLLING_TYPE {
  HEALTHY = 'healthy',
  UN_HEALTHY = 'unhealthy',
}

export const enum WEB_SERVICE_STATUS {
  UN_KNOWN = 'unknown',
  HEALTHY = 'healthy',
  UN_HEALTHY = 'unhealthy',
}

export const enum FAILOVER_PROGRESS {
  FAILOVER_STARTED = 'failover_started',
  HEALTHY_TARGET_NOT_AVAILABLE = 'failover_target_not_available',
  HEALTHY_TARGET_FOUND = 'failover_target_found',
  DNS_UPDATED = 'failover_dns_updated',
  FAILOVER_COMPLETED = 'failover_completed',
  FAILOVER_FAILED = 'failover_failed',
}

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
  unhealthy_interval: number
  healthy_interval: number
  fall: number
  rise: number
  connect_timeout: number
  read_timeout: number
  cool_down: number
  // remote (mate) service properties
  is_remote: boolean
}

export type ipPassFailState = {
  failing: number
  passing: number
  last_update: Date
}

export type mateSpecificParamsType = {
  addressses: string []
  last_update: Date | null
  is_orphan: boolean
}

export type checksStateType = {
  [trackedByCaptainUrl: string]: {
    [ipAddress: string]: ipPassFailState
  }
}

export type typeWebServiceState = {
  // service: typeWebServiceConf,
  is_orphan: boolean
  mates?: {
    [mateID: string]: mateSpecificParamsType
  }
  checks: checksStateType,
  active: Array<string>
  status?: WEB_SERVICE_STATUS
  failover?: null
  failover_progress?: FAILOVER_PROGRESS | null
  failover_progress_date_time?: Date | null
  failover_progress_history?: {failover_progress: FAILOVER_PROGRESS; failover_progress_date_time: Date}[] | null
  failover_started?: Date | null
  failover_finished?: Date | null
}

/**
 * Discover 'static' services to be directly managed by the 'captain' by reading the 'services.yaml'.
 * Called on 'startup' and also using 'SIGHUP' signal
 *
 */
async function processWebServiceFileYAML() {
  logger.info('processServiceFileYAML', {
    file: appConfig.WEBSERVICE_YAML_LOCATION
  })
  if (existsSync(appConfig.WEBSERVICE_YAML_LOCATION)) {
    logger.info('processServiceFileYAML:1')
    const servicesFile = await fs.readFile(appConfig.WEBSERVICE_YAML_LOCATION, 'utf8')
    logger.info('processServiceFileYAML:2')
    const loadedYaml = YAML.parse(servicesFile)
    // logger.info('processServiceFileYAML:3', {
    //   loadedYaml: JSON.stringify(loadedYaml, undefined, 2)
    // });
    await appState.registerLocalWebServices(loadedYaml?.services)
  } else {
    logger.info('processServiceFileYAML:11')
    throw new Error(`WebService YAML file location invalid: ${appConfig.WEBSERVICE_YAML_LOCATION}`)
  }
}

/**
 * Utility method to read response body from https.get or http.get
 *
 * @export
 * @param {http.IncomingMessage} res
 * @return {*}  {Promise<string>}
 */
function readResponseBodyFromHealthCheck(res: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      const chunks: any[] = []
      res.on('data', (chunk) => {
        logger.debug('readResponseBodyFromHealthCheck:data')
        chunks.push(chunk)
      })
      res.on('end', () => {
        logger.debug('readResponseBodyFromHealthCheck:end')
        const body = Buffer.concat(chunks)
        resolve(body.toString('utf-8'))
      })
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * Check with peer's state and decide if the ip needs to be added to 'active_addresses' of the service.
 * Need to handle 'multi' too.
 * Called only by 'leader'
 */
//handleAgreedPassingStateOfIP
//verifyCombinedChecksAndHandlePassingIP
async function checkCombinedPeerStateAndInitiateAddActiveIP(webService: WebServiceManager, ipAddress: string) {
  const logID = `${webService?.logID}: checkCombinedPeerStateAndInitiateAddActiveIP ip: ${ipAddress}`
  let raceCondLock
  try {
    logger.info(logID)
    // console.trace(new Date().toUTCString(), logID)
    // Don't use logID!. Only use webService.logID, so as to lock across several operations of the webservice
    raceCondLock = await appState.getRaceHandler().getLock(webService.logID)
    // Verify 'passing' aggreement with all 'peer' checks
    if (verifyPassingAggreement(webService, ipAddress)) {
      // appState.getConsulService() will be undefined for 'fallback' leadership, in which case, we skip 'reAffirmLeadership'
      if (appState.getConsulService()) {
        if (!appState.getConsulService().reAffirmLeadership()) {
          // Only leader can alter active addresses
          return false;
        }
      }
      const activeAddresses = webService.serviceState.active || []
      // ipAddress can be added to the system in the following three cases.
      // a). Failover new target
      // b). Last Failover failed
      // c). multi=true ( round robin )
      if (
        webService.isFailOverInProgress() &&
        webService.serviceState.failover_progress === FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE
      ) {
        // a). Failover is in progress (cooldown active).
        // But No healthy ('passing') failover target was available at the time failover 'starting'.
        // But now we have a suitable target (new found 'passing' ip).
        logger.info(
          logID,
          'previousState: FAILOVER_PROGRESS:HEALTHY_TARGET_NOT_AVAILABLE',
          'newState: We got new healthy ip now, doing failover'
        )
        await failOverAndUpdateProgress(webService, activeAddresses?.[0], ipAddress)
      } else if (
        !webService.isFailOverInProgress() &&
        webService.serviceState.status === WEB_SERVICE_STATUS.UN_HEALTHY
      ) {
        // b). webService is 'unhealthy'. This happens when previous failover failed.
        // But now we have chance to do successful failover as we have a healthy ipaddress
        // Initiate the whole failover process
        logger.info(logID, 'WEB_SERVICE_STATUS.UN_HEALTHY')
        webService.beginFailOverProcess(webService.serviceState.active[0]!)
        await failOverAndUpdateProgress(webService, webService.serviceState.active?.[0], ipAddress)
      } else {
        // need to be added only if it's not already in 'active_address'es
        if (!activeAddresses.includes(ipAddress)) {
          if (webService.serviceConf.multi) {
            // c). multi=true ( ROUND ROBIN ). Any 'passing' ip can be added into the system in this case
            logger.info(logID, 'multi')
            const newActiveAddresses = []
            newActiveAddresses.push(...webService.serviceState.active)
            newActiveAddresses.push(ipAddress)
            await webService.handleActiveAddressChange(newActiveAddresses)
          } else {
            logger.info(logID, 'Ignore. Neither "multi" nor "unhealthy"')
          }
        } else {
          logger.info(logID, `Ignore. Already part of active addresses: ${activeAddresses}`)
        }
      }
    }
  } catch (e: any) {
    logger.error(new Error(`${logID}: Details: ${e?.message}`, {cause: e}))
  } finally {
    appState.getRaceHandler().releaseLock(raceCondLock)
  }
}

/**
 * Check with peer's state and decide if the ip needs to be removed from 'active_addresses' of the service.
 * Need to handle 'failover' too.
 * Called only by 'leader'
 */
//handleAgreedFailingStateOfIP
//verifyCombinedChecksAndHandleFailingIP
async function checkCombinedPeerStateAndInitiateRemoveActiveIP(
  webService: WebServiceManager,
  ipAddress: string
) {
  const logID = `${webService?.logID}: checkCombinedPeerStateAndInitiateRemoveActiveIP ip: ${ipAddress}`
  let raceCondLock
  try {
    logger.info(logID)
    // console.trace(new Date().toUTCString(), logID)
    // Don't use logID!. Only use webService.logID, so as to lock across several operations of the webservice
    raceCondLock = await appState.getRaceHandler().getLock(webService.logID)
    // Verify 'failing' aggreement with all 'peer' checks
    if (verifyFailingAggreement(webService, ipAddress)) {
      // appState.getConsulService() will be undefined for 'fallback' leadership, in which case, we skip 'reAffirmLeadership'
      if (appState.getConsulService()) {
        if (!appState.getConsulService().reAffirmLeadership()) {
          // Only leader can alter active addresses
          return false;
        }
      }
      // When failover is in progress ( cool down ), ignore request to remove any ip and ignore potentially processing another failover
      // eg: the new failed over target itself could go down but wait until failover cooldown before making decision
      if (webService.isFailOverInProgress()) {
        logger.warn(logID, 'Ignore. Since FailOverInProgress')
        return
      }
      const activeAddresses = webService.serviceState.active || []
      logger.info(logID, 'stage:1', activeAddresses)
      // Ensure, it is in 'active' address list ( otherwise removing not needed )
      if (activeAddresses.includes(ipAddress)) {
        const remainingActiveAddresses = activeAddresses.filter((eachAddress) => {
          return eachAddress !== ipAddress
        })
        logger.info(logID, 'stage:2', remainingActiveAddresses)
        if (remainingActiveAddresses?.length && remainingActiveAddresses?.length >= 1) {
          // Since we have 'remaining' active addresses, just-remove-failing-one, FAILOVER NOT NEEDED
          // multi=true case
          logger.info(logID, 'stage:3')
          await webService.handleActiveAddressChange(remainingActiveAddresses)
        } else {
          // It is the only active address. FAILOVER NEEDED
          // Generally multi=false ( OR multi=true with only one active address )
          // In both the cases, we can try if failover target is available
          logger.info(logID, 'stage:4')
          if (
            webService.serviceState.failover_progress === FAILOVER_PROGRESS.FAILOVER_FAILED &&
            !webService.isHealthy()
          ) {
            // The last failover 'failed', service marked 'unhealthy' and also 'notified'
            // So don't trigger another failover and leading to duplicate 'notification'
            // Let the other method 'checkCombinedPeerStateAndInitiateAddActiveIP', look for a healthy ip,
            // and trigger failover
            logger.info(logID, 'stage:5')
            logger.info(
              logID,
              'FAILOVER_SKIPPED',
              '\n',
              'Reason: ',
              '\n',
              "The last failover 'failed', service marked 'unhealthy' and also 'notified'.",
              '\n',
              "So don't trigger another failover and leading to duplicate 'notification'.",
              '\n',
              "Let the other method 'checkCombinedPeerStateAndInitiateAddActiveIP', look for a healthy replacement ip, and trigger failover"
            )
          } else {
            logger.info(logID, 'stage:6')
            webService.beginFailOverProcess(ipAddress)
            const failOverIPAddress = findFailOverTargets(webService)?.[0]
            if (failOverIPAddress) {
              await failOverAndUpdateProgress(webService, ipAddress, failOverIPAddress)
              logger.info(logID, 'stage:5')
            } else {
              webService.updateFailOverProgress(FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
              logger.info(logID, 'stage:6')
            }
          }
        }
      } else {
        logger.info(logID, `Ignore. Not part of active addresses: ${activeAddresses}`)
      }
    }
  } catch (e: any) {
    logger.error(new Error(`${logID}: Details: ${e?.message}`, {cause: e}))
  } finally {
    appState.getRaceHandler().releaseLock(raceCondLock)
  }
}

/**
 * Verify 'checks' data of all the 'captains' to agree on 'passing'
 */
function verifyPassingAggreement(webService: WebServiceManager, ipAddress: string) {
  const logID = `${webService.logID} verifyPassingAggreement: ${ipAddress}`
  const checksDataForGivenIP = webService.getChecksDataForGivenIP(ipAddress)
  logger.debug(logID, checksDataForGivenIP)

  // For now 'every' captain must agree, may be changed later
  const countRequiredForAggrement = appConfig.MEMBER_URLS.length
  const actualAggrementCount = Object.keys(checksDataForGivenIP).filter((eachCaptainUrl: string) => {
    if (checksDataForGivenIP?.[eachCaptainUrl]?.passing) {
      // check 'rise' limit to ensure 'passing'
      return checksDataForGivenIP[eachCaptainUrl]!.passing >= webService.rise  
    } else {
      return false
    }
  }).length // count of captains that has 'passing'

  // Enough captain's state agree on 'passing'
  if (actualAggrementCount >= countRequiredForAggrement) {
    logger.info(logID, true)
    return true
  } else {
    logger.info(logID, false)
    return false
  }
}

/**
 * Verify 'checks' data of all the 'captains' to agree on 'failing'
 */
function verifyFailingAggreement(webService: WebServiceManager, ipAddress: string) {
  const checksDataForGivenIP = webService.getChecksDataForGivenIP(ipAddress)
  logger.debug(webService.logID, `verifyFailingAggreement: ${ipAddress}:`, checksDataForGivenIP)

  // For now 'every' captain must agree, may be changed later
  const countRequiredForAggrement = appConfig.MEMBER_URLS.length
  const actualAggrementCount = Object.keys(checksDataForGivenIP).filter((eachCaptainUrl: string) => {
    if (checksDataForGivenIP?.[eachCaptainUrl]?.failing) {
      // check 'fall' limit to ensure 'failing'
      return checksDataForGivenIP[eachCaptainUrl]!.failing >= webService.fall  
    } else {
      return false
    }
  }).length // count of captains that has 'failing'

  // Enough captain's state agree on 'failing'
  if (actualAggrementCount >= countRequiredForAggrement) {
    logger.info(webService.logID, `verifyFailingAggreement: ${ipAddress}:`, true)
    return true
  } else {
    logger.info(webService.logID, `verifyFailingAggreement: ${ipAddress}:`, false)
    return false
  }
}

/**
 * Qualify the available addresses and find the target for 'failover' usings 'checks' data
 */
function findFailOverTargets(webService: WebServiceManager): string[] | undefined {
  logger.info(webService.logID, 'findFailOverTarget', webService.serviceState.checks)
  const qualifyingAddresses = webService.serviceConf.addresses.filter((eachIpAddress) => {
    // verify passing with peers using 'checks' data
    return verifyPassingAggreement(webService, eachIpAddress)
  })
  if (qualifyingAddresses?.[0]) {
    // atleast there is one
    return qualifyingAddresses
  } else {
    return undefined
  }
}

/**
 * Arrange for failover by replacing one ip with other.
 * Update failver progress.
 */
async function failOverAndUpdateProgress(
  webService: WebServiceManager,
  oldIpAddress: string | undefined,
  newIpAddress: string
) {
  webService.updateFailOverProgress(FAILOVER_PROGRESS.HEALTHY_TARGET_FOUND)
  const newActiveAddresses = []
  // Push, everything except old ip address.
  // Normally this will be empty as failover done only when there is no other active addresses. Still trying to preserve any existing active addresses.
  newActiveAddresses.push(
    ...webService.serviceState.active?.filter((eachAddress) => {
      return eachAddress !== oldIpAddress
    })
  )
  // Add new ip address.
  newActiveAddresses.push(newIpAddress)
  await webService.handleActiveAddressChange(newActiveAddresses)
  webService.updateFailOverProgress(FAILOVER_PROGRESS.DNS_UPDATED)
}

const webServiceHelper = {
  processWebServiceFileYAML,
  readResponseBodyFromHealthCheck,
  checkCombinedPeerStateAndInitiateAddActiveIP,
  checkCombinedPeerStateAndInitiateRemoveActiveIP,
  verifyPassingAggreement,
  verifyFailingAggreement
}

export default webServiceHelper