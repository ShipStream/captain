// import {logger} from './coreUtils.js'
import appConfig from './appConfig.js'
import {typeWebServiceConf} from './web-service/webServiceHelper.js'
import {WebServiceManager} from './web-service/webServiceManager.js'

// 'State' (Hash) of all web services.
// Using zone record as unique key.
export const webServices: {
  [key: string]: WebServiceManager
} = {}

/**
 * Initiate a manager ('WebServiceManager') for each 'web service' to be managed by the 'captain'.
 * Store 'instance' into global state.
 * @export
 * @param {typeWebServiceConf} serviceConf
 */
export function registerWebService(serviceConf: typeWebServiceConf) {
  // Using zone record as unique key
  const webService = new WebServiceManager(serviceConf)
  webServices[webService.serviceKey] = webService
}

// // Output 'state' for debugging
// setInterval(() => {
//   logger.info(
//     'appState:webServices',
//     JSON.stringify(
//       Object.keys(webServices).map((eachKey) => {
//         return webServices[eachKey]?.serviceState
//       }),
//       undefined,
//       2
//     )
//   )
//   logger.info('appState:leader', {
//     'getLeaderUrl()': getLeaderUrl(),
//     'isLeader()': isLeader(),
//   })
// }, 5000)

// Maintain 'state' about leader of the 'captains'
let leaderURL: string

export function setLeaderUrl(inputLeaderUrl: string) {
  leaderURL = inputLeaderUrl
}

export function getLeaderUrl() {
  return leaderURL
}

/**
 * If stored 'leaderUrl' is same as 'url' of current instance, then return 'true'
 *
 * @export
 * @return {*}  {boolean}
 */
export function isLeader(): boolean {
  return leaderURL === appConfig.SELF_URL
}
