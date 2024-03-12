import {delay} from 'msw'
import {join} from 'path'
import appConfig, {processAppEnvironement} from '../../src/appConfig.js'
import appState from '../../src/appState.js'
import {WebServiceManager} from '../../src/webServiceManager.js'
import {initializeAppModules} from '../../src/coreUtils.js'
import commonTest, {MATCH_ANY_VALUE} from './commonTest.utils.js'
import captainMockTest from './remoteCaptainMock.utils.js'
import requestMockTest from './requestMock.utils.js'

jest.spyOn(WebServiceManager.prototype, 'pollSuccessRoundRobin')
jest.spyOn(WebServiceManager.prototype, 'pollFailedRoundRobin')  
jest.spyOn(WebServiceManager.prototype, 'pollAndGetStateOfAdjacentIps')
jest.spyOn(WebServiceManager.prototype, 'pollEachAddress')

/**
 * Create mock/spy on required webservice methods
 *
 * @param {WebServiceManager} webService
 */
function mockKeyMethodsOfWebService(webService: WebServiceManager) {
  jest.spyOn(webService, 'pollSuccessRoundRobin')
  jest.spyOn(webService, 'pollFailedRoundRobin')  
}

/**
 * Fake timers requires manual control/passage of time and for long process like 'initializeAppModules',
 * we might require separate loop that advances time until the completion of 'initialization'
 *
 */
async function inititalizeAppModulesUsingFakeTimers() {
  let initializationState = undefined
  let error = undefined
  initializeAppModules().then((_data) => {
    initializationState = true
  }).catch((e) => {
    error = e
    initializationState = false
  })
  // until 'initializeAppModules' promise completes, advance time
  while(initializationState === undefined) {
    // advance set amount of 'fake-time' for the given amount of 'real-time' in each loop,
    // so that any async-callback/setTimeout/setInterval in the 'initializeAppModules' gets executed
    await commonTest.passRealTimeInMillis(50) // wait for the passage of realtime
    if (commonTest.usingFakeTimers()) {
      await jest.advanceTimersByTimeAsync(150) // advance faketime
    }
  }
  if (error) {
    throw error
  }
}

async function beforeTestAppInitializer({
  patchedAppConfig, additionalOptions
}: {
  patchedAppConfig?: any,
  additionalOptions?: {
    useFakeTimer?: boolean // Whether to use fake timer or real timer for the tests
  },
} = {}) {
  processAppEnvironement()
  Object.assign(appConfig, patchedAppConfig)
  await commonTest.passTimeInMillis(2000)
  if (additionalOptions?.useFakeTimer ?? true) {
    jest.useFakeTimers()
  }
  await captainMockTest.mockRemoteCaptains(getRemoteCaptains())
  await commonTest.passTimeInMillis(1000)
  // initialize the modules during every test as it will be cleanedup/reset after each test
  await inititalizeAppModulesUsingFakeTimers()
  // await initializeAppModules()
  await commonTest.advanceBothRealAndFakeTime(1000)
  // setup '200' response all ips of all the loaded webServices
  // webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
}

async function cleanAndReset() {
  // commonTest.attentionLog('end:1', JSON.stringify({ result: spyHandleActiveAddressChange.mock.results }))
  requestMockTest.getMswServer().resetHandlers()
  await captainMockTest.clearRemoteCaptains()
  await commonTest.advanceBothRealAndFakeTime(1000)
  await appState.resetAppState({resetSockets: true, resetWebApps: true, resetLockHandlers: true})
  // await jest.runOnlyPendingTimersAsync()
  jest.useRealTimers()
  await delay(1000)
  // commonTest.attentionLog('end:4', JSON.stringify({ result: spyHandleActiveAddressChange.mock.results }))
}

function getServicesYAMLPath(inputFileName: string) {
  return join('..', 'data', inputFileName)
}

function getRemoteCaptains() {
  return appConfig.CAPTAIN_URL
}

const appTest = {
  mockKeyMethodsOfWebService,
  beforeTestAppInitializer,
  cleanAndReset,
  getServicesYAMLPath,
  getRemoteCaptains,
}

export default appTest
