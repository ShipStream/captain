import console from 'console'
import {delay, http, passthrough, HttpResponse as mswHttpResponse} from 'msw'
import {ReadableStream} from 'stream/web'
import appConfig, {processAppEnvironement} from './../../src/appConfig.js'
import appState from './../../src/appState.js'
import {WebServiceManager} from './../../src/web-service/webServiceManager.js'
import * as WebServiceHelper from './../../src/web-service/webServiceHelper.js'
import {WEB_SERVICE_STATUS} from './../../src/web-service/webServiceHelper.js'
import {initializeAppModules} from './../../src/coreUtils.js'
import technitiumDnsManager, {
  createZoneIfNotAvailable,
  deleteZoneWithAllEntries,
} from './../../src/dns/technitiumDnsManager.js'
import commonTest, {MATCH_ANY_VALUE} from './commonTest.utils.js'
import socketMockTest from './socketMockTest.utils.js'
import {SetupServer, setupServer as setupMswServer} from 'msw/node'

function getPollingInterval(webService: WebServiceManager) {
  return webService.serviceState.status === WEB_SERVICE_STATUS.HEALTHY
    ? webService.healthyInterval
    : webService.unhealthyInterval
}

function getChecksDataByCaptainAndIP(webService: WebServiceManager, captainUrl: string, targetIP: string) {
  return webService.serviceState.checks[captainUrl]?.[targetIP]
}

function passingResponses(ipList: Array<string>) {
  return ipList.map((eachIp) => {
    return http.get(`http://${eachIp}/health`, async ({request, params, cookies}) => {
      return mswHttpResponse.json({status: 'ok'}, {status: 200})
    })
  })
}

function passingWithDelayResponses(ipList: Array<string>, delayInMs: number) {
  return ipList.map((eachIp) => {
    return http.get(`http://${eachIp}/health`, async ({request, params, cookies}) => {
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(JSON.stringify({message: 'Is healthy'}))
          controller.enqueue(JSON.stringify({status: 200}))
          await delay(Math.floor(delayInMs))
          controller.close()
        },
      })
      return new mswHttpResponse(stream, {
        headers: {
          'Content-Type': 'text/html',
          'Transfer-Encoding': 'chunked',
        },
      })
    })
  })
}

function failByNetworkErrorResponses(ipList: Array<string>) {
  return ipList.map((eachIp) => {
    return http.get(`http://${eachIp}/health`, async ({request, params, cookies}) => {
      await delay(1000)
      return mswHttpResponse.error()
    })
  })
}

// export function createFailByNetworkErrorResponses(ipList: Array<string>) {
//   return ipList.map((eachIp) => {
//     return http.get(`http://${eachIp}/health`, async ({request, params, cookies}) => {
//       await delay(1000)
//       return mswHttpResponse.json({status: 'failed'}, {status: 500})
//     })
//   })
// }

jest.spyOn(WebServiceManager.prototype, 'handleActiveAddressChange')
jest.spyOn(WebServiceManager.prototype, 'pollSuccess')
jest.spyOn(WebServiceManager.prototype, 'pollFailed')
jest.spyOn(WebServiceManager.prototype, 'beginFailOverProcess')
jest.spyOn(WebServiceHelper.default, 'checkCombinedPeerStateAndInitiateAddActiveIP')
jest.spyOn(WebServiceHelper.default, 'checkCombinedPeerStateAndInitiateRemoveActiveIP')

let mswServer: SetupServer

export function getMswServer() {
  return mswServer!
}

function setupMswReqMocks() {
  // global.console = console
  // Use onUnhandledRequest: 'error' and list all possible urls even if it requires 'passthrough',
  // so as to make sure we don't miss anything
  mswServer = setupMswServer(
    ...passingWithDelayResponses(
      [
        '10.5.0.21',
        '10.5.0.22',
        '10.5.0.23',
        '10.5.0.31',
        '10.5.0.32',
        '10.5.0.33',
        '10.5.0.34',
        '10.5.0.41',
        '10.5.0.42',
      ],
      1000
    ),
    // Passthrough and send all dns-server entries to technitium docker container
    http.all(`${appConfig.TECHNITIUM_BASE_URL}/*`, async ({request, params, cookies}) => {
      return passthrough()
    }),
    // Passthrough and send all socket requests as we have setup real sockets
    ...appConfig.MEMBER_URLS?.map((eachUrl: string) => eachUrl.replace('ws://', 'http://'))?.map(
      (eachCaptain: string) =>
        http.all(`${eachCaptain}/socket.io/`, async ({request, params, cookies}) => {
          return passthrough()
        })
    )
  )
}

async function beforeTestAppInitializer({
  existingDnsRecords, patchedAppConfig
}: {
  existingDnsRecords?: {zoneRecord: string; ipAddresses: string[]}[],
  patchedAppConfig?: any
} = {}) {
  processAppEnvironement()
  Object.assign(appConfig, patchedAppConfig)
  // empty dns records
  // commonTest.attentionLog('start:1', JSON.stringify({ result: spyHandleActiveAddressChange.mock.results }))
  await deleteZoneWithAllEntries()
  if (existingDnsRecords) {
    await createZoneIfNotAvailable()
    for (const eachDnsRecord of existingDnsRecords) {
      await technitiumDnsManager.addZoneRecordMulti(eachDnsRecord.zoneRecord, eachDnsRecord.ipAddresses)
    }
  }
  await commonTest.passTimeInMillis(2000)
  jest.useFakeTimers()
  await socketMockTest.mockRemoteCaptains(commonTest.getRemoteCaptains())
  // initialize the modules during every test as it will be cleanedup/reset after each test
  await initializeAppModules()
  // setup '200' response all ips of all the loaded webServices
  // webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
}

async function cleanAndReset() {
  // commonTest.attentionLog('end:1', JSON.stringify({ result: spyHandleActiveAddressChange.mock.results }))
  mswServer.resetHandlers()
  await socketMockTest.clearRemoteCaptains()
  await commonTest.advanceBothRealAndFakeTime(1000)
  await appState.resetAppState({resetSockets: true, resetWebApps: true, resetLockHandlers: true})
  // await jest.runOnlyPendingTimersAsync()
  jest.useRealTimers()
  await delay(1000)
  // commonTest.attentionLog('end:4', JSON.stringify({ result: spyHandleActiveAddressChange.mock.results }))
}

function getTimeOutInMillisPollSuccess(webService: WebServiceManager, noOfTime: number) {
  return (
    (webAppTest.getPollingInterval(webService) * noOfTime + (webService.readTimeout + webService.connectTimeout) + 5) *
    1000
  )
}

function getTimeOutInMillisPollFailed(webService: WebServiceManager, noOfTime: number) {
  return (
    (webAppTest.getPollingInterval(webService) * noOfTime + (webService.readTimeout + webService.connectTimeout) + 5) *
    1000
  )
}

const webAppTest = {
  getChecksDataByCaptainAndIP,
  passingResponses,
  passingWithDelayResponses,
  failByNetworkErrorResponses,
  getPollingInterval,
  beforeTestAppInitializer,
  cleanAndReset,
  getMswServer,
  getTimeOutInMillisPollSuccess,
  getTimeOutInMillisPollFailed,
  setupMswReqMocks,
}

export default webAppTest
