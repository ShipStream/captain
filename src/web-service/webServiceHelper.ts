import fs from 'fs/promises';
import { existsSync } from 'fs';
import http from 'http';
import YAML from 'yaml'
import { WebServiceManager } from './webServiceManager.js';
import { registerWebService, webServices } from '../appState.js';
import { broadcastActiveAddresses } from '../socket/captainSocketServerManager.js';
import appConfig from '../appConfig.js';
import { dnsManager } from '../dns/dnsManager.js';

export type typeWebServiceConf = {
  name: string,
  description: string,
  tags: Array<string>,
  zone_record: string,
  addresses: Array<string>,
  multi: boolean,
  check: {
    protocol: string,
    host: string,
    port: number,
    path: string
  },
  unhealthy_interval: number,
  healthy_interval: number,
  fall: number,
  rise: number,
  connect_timeout: number,
  read_timeout: number,
  cool_down: number
}

type ipPassFailState = {
  failing: number,
  passing: number,
  last_update: Date | null
}

export type typeWebServiceState = {
  service: typeWebServiceConf,
  is_remote: boolean,
  is_orphan: boolean,
  mates: Array<any> | null,
  checks: Record<string, Record<string, ipPassFailState>>,
  active: Array<string>,
  status: "unhealthy" | "healthy",
  failover: null,
  failover_started: Date | null,
  failover_finished: Date | null
}

/**
 * Discover 'static' services to be directly managed by the 'captain' by reading the 'services.yaml'.
 * Called on 'startup' and also using 'SIGHUP' signal
 * 
 */
export async function processWebServiceFileYAML() {
  console.log('processServiceFileYAML');
  const servicesFile = await fs.readFile("/data/services.yaml", 'utf8')
  const loadedYaml = YAML.parse(servicesFile);
  // console.log('processServiceFileYAML:2', {
  //   loadedYaml: JSON.stringify(loadedYaml, undefined, 2)
  // });
  for (const service of loadedYaml?.services) {
    registerWebService(service)
  }
}

/**
 * Utility method to read response body from https.get or http.get
 *
 * @export
 * @param {http.IncomingMessage} res
 * @return {*}  {Promise<string>}
 */
export function readResponseBodyFromHealthCheck(res: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      const chunks: any[] = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve(body.toString('utf-8'))
      });
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * Check with peer's state and decide if the ip needs to be added to active address of the service.
 * Need to handle 'multi' too.
 * Called only by 'leader'
 */
export function checkCombinedPeerStateAndInitiateAddActiveIP(webService: WebServiceManager, ipAddress: string) {
  console.log(webService.logID, 'checkCombinedPeerStateAndInitiateAddActiveIP')
  const activeAddresses = webService.serviceState.active

  // Ensure, it is not already an 'active' address
  // Also ensure 'multi' active addresses ( ROUND ROBIN ) supported
  if (!activeAddresses.includes(ipAddress) && webService.serviceState.service.multi) {
    // For now 'every' captain must agree, may be changed later
    const countRequiredForAggrement = appConfig.MEMBER_URLS.length
    const actualAggrementCount = Object.keys(webService.serviceState.checks).filter((eachCaptainUrl: string) => {
      const eachCheckData = webService.serviceState.checks[eachCaptainUrl]![ipAddress]!
      // check 'rise' limit to ensure 'passing'
      return eachCheckData.passing >= webService.rise
    })
    .length // count of captains that has 'passing'

    // Enough captain's state agree on 'passing'
    if (actualAggrementCount >= countRequiredForAggrement) {
      webService.serviceState.active.push(ipAddress)
      dnsManager.addZoneRecord(webService.serviceState.service.zone_record, ipAddress)
    }
  }
}

/**
 * Check with peer's state and decide if the ip needs to be removed from active address of the service.
 * Need to handle 'failover' too.
 * Called only by 'leader'
 */
export function checkCombinedPeerStateAndInitiateRemoveActiveIP(webService: WebServiceManager, ipAddress: string) {
  console.log(webService.logID, 'checkCombinedPeerStateAndInitiateRemoveActiveIP')
  const activeAddresses = webService.serviceState.active
  // Ensure, it is in 'active' address list
  if (activeAddresses.includes(ipAddress)) {
    // For now 'every' captain must agree, may be changed later
    const countRequiredForAggrement = appConfig.MEMBER_URLS.length
    const actualAggrementCount = Object.keys(webService.serviceState.checks).filter((eachCaptainUrl: string) => {
      const eachCheckData = webService.serviceState.checks[eachCaptainUrl]![ipAddress]!
      // check 'fall' limit to ensure 'failing'
      return eachCheckData.failing >= webService.fall
    })
    .length // count of captains that has 'failing'

    // Enough captain's state agree on 'failing'
    if (actualAggrementCount >= countRequiredForAggrement) {
      const failOverIPAddress = findFailOverTarget(webService)
      failOver(webService, ipAddress, failOverIPAddress)
    }
  }
}

/**
 * Qualify the available addresses and find the target for 'failover' usings 'checks' data
 */
function findFailOverTarget(webService: WebServiceManager): string {
  console.log(webService.logID, 'findFailOverTarget')
  // For now 'every' captain must agree, may be changed later
  const countRequiredForAggrement = appConfig.MEMBER_URLS.length
  const qualifyingAddresses = webService.serviceState.service.addresses.filter((eachIpAddress) => {
    const actualAggrementCount = Object.keys(webService.serviceState.checks).filter((eachCaptainUrl: string) => {
      const eachCheckData = webService.serviceState.checks[eachCaptainUrl]![eachIpAddress]!
      // check 'rise' limit to ensure 'passing'
      return eachCheckData.passing >= webService.rise
    })
    .length // count of captains that has 'passing'
    return actualAggrementCount >= countRequiredForAggrement
  })
  if (qualifyingAddresses?.[0]) {
    return qualifyingAddresses[0]
  } else {
    // TODO
    throw new Error('Unable to find failover target')
  }
}

/**
 * Arrange for failover
 */
function failOver(webService: WebServiceManager, oldIpAddress: string, newIpAddress: string) {
  // add new ip address
  webService.serviceState.active.push(newIpAddress)
  // remove old ip address
  webService.serviceState.active = webService.serviceState.active?.filter((eachAddress) => {
    return eachAddress !== oldIpAddress
  })
  dnsManager.removeZoneRecord(webService.serviceState.service.zone_record, oldIpAddress)
  dnsManager.addZoneRecord(webService.serviceState.service.zone_record, newIpAddress)
}

/**
 * Set initial active address(s) on startup. Called only by 'leader'
 *
 * @export
 * @param {WebServiceManager} webService
 */
export function setInitialActiveAddressesForWebService(webService: WebServiceManager) {
  if (webService.serviceState.service.multi) {
    // multiple active addresses
    // add all available addresses to 'active' list
    webService.serviceState.active = [...webService.serviceState.service.addresses]
    dnsManager.addZoneRecordMulti(webService.serviceState.service.zone_record, webService.serviceState.active)
  } else {
    // single active address
    // add 'first' among the available addresses to 'active' list
    webService.serviceState.active = [webService.serviceState.service.addresses[0]!]
    dnsManager.addZoneRecord(webService.serviceState.service.zone_record, webService.serviceState.active[0]!)
  }
  broadcastActiveAddresses(webService)
}