import {delay} from 'msw'
import {join} from 'path'
import appConfig, {processAppEnvironement} from '../../src/appConfig.js'
import appState from '../../src/appState.js'
import {WebServiceManager} from '../../src/web-service/webServiceManager.js'
import * as WebServiceHelper from '../../src/web-service/webServiceHelper.js'
import {WEB_SERVICE_STATUS} from '../../src/web-service/webServiceHelper.js'
import {initializeAppModules} from '../../src/coreUtils.js'
import technitiumDnsManager, {
  createZoneIfNotAvailable,
  deleteZoneWithAllEntries,
} from '../../src/dns/technitiumDnsManager.js'
import commonTest, {MATCH_ANY_VALUE} from './commonTest.utils.js'
import socketMockTest from './socketMockTest.utils.js'
import mateMockTest from './mateMockTest.utils.js'
import requestMockTest from './requestMockTest.utils.js'

function getPollingInterval(webService: WebServiceManager) {
  return webService.serviceState.status === WEB_SERVICE_STATUS.HEALTHY
    ? webService.healthyInterval
    : webService.unhealthyInterval
}

function getChecksDataByCaptainAndIP(webService: WebServiceManager, captainUrl: string, targetIP: string) {
  return webService.serviceState.checks[captainUrl]?.[targetIP]
}

jest.spyOn(WebServiceManager.prototype, 'handleActiveAddressChange')
jest.spyOn(WebServiceManager.prototype, 'pollSuccess')
jest.spyOn(WebServiceManager.prototype, 'pollFailed')
jest.spyOn(WebServiceManager.prototype, 'pollEachAddress')
jest.spyOn(WebServiceManager.prototype, 'beginFailOverProcess')
jest.spyOn(WebServiceHelper.default, 'checkCombinedPeerStateAndInitiateAddActiveIP')
jest.spyOn(WebServiceHelper.default, 'checkCombinedPeerStateAndInitiateRemoveActiveIP')


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
  await socketMockTest.mockRemoteCaptains(getRemoteCaptains())
  await mateMockTest.mockMateClients(mateMockTest.getMateIDs())
  // initialize the modules during every test as it will be cleanedup/reset after each test
  await initializeAppModules()
  await commonTest.advanceBothRealAndFakeTime(1000)
  // setup '200' response all ips of all the loaded webServices
  // webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
}

async function cleanAndReset() {
  // commonTest.attentionLog('end:1', JSON.stringify({ result: spyHandleActiveAddressChange.mock.results }))
  requestMockTest.getMswServer().resetHandlers()
  await socketMockTest.clearRemoteCaptains()
  await commonTest.advanceBothRealAndFakeTime(1000)
  await appState.resetAppState({resetSockets: true, resetWebApps: true, resetLockHandlers: true, resetLeaderShip: true})
  // await jest.runOnlyPendingTimersAsync()
  jest.useRealTimers()
  await delay(1000)
  // commonTest.attentionLog('end:4', JSON.stringify({ result: spyHandleActiveAddressChange.mock.results }))
}

function getServicesYAMLPath(inputFileName: string) {
  return join('..', 'data', inputFileName)
}

function getRemoteCaptains() {
  return appConfig.MEMBER_URLS?.filter((eachUrl: string) => eachUrl !== appConfig.SELF_URL)
}


const appTest = {
  getChecksDataByCaptainAndIP,
  getPollingInterval,
  beforeTestAppInitializer,
  cleanAndReset,
  getServicesYAMLPath,
  getRemoteCaptains,
}

export default appTest
