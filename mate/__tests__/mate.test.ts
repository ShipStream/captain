// Env setup. Needs to be the first import
import './env/mateTest.env.js'

// Other imports
import console from 'console'
import appConfig from '../src/appConfig.js'
import appState from '../src/appState.js'
import { logger } from '../src/coreUtils.js'
import appTestUtil from './utils/appTest.utils.js'
import requestMockUtil from './utils/requestMock.utils.js'
import commonTestUtil, { MATCH_ANY_VALUE } from './utils/commonTest.utils.js'
import remoteCaptainMockUtil from './utils/remoteCaptainMock.utils.js'
import higherOrderUtil from './utils/higherOrderTest.utils.js'
import { PASS_FAIL_IP_STATES, WebServiceManager } from '../src/webServiceManager.js'

beforeAll(async () => {
  requestMockUtil.setupMswReqMocks()
  requestMockUtil.getMswServer().listen({
    onUnhandledRequest: 'error',
  })
})

afterEach(async () => {
  await appTestUtil.cleanAndReset()
})

afterAll(async () => {
  requestMockUtil.getMswServer().close()
})

jest.setTimeout(700000)

describe('Tests. Primary/Common', () => {
  const serviceKey = 'forum-app'
  //mate-1 forum-app private ips',
  const targetIPs = [
    '10.5.0.122',
    '10.5.0.123',
    '10.5.0.124',
    '10.5.0.125',
    '10.5.0.126',
    '10.5.0.127',
    '10.5.0.128',
    '10.5.0.129'
  ]

  expect(appTestUtil.getRemoteCaptains()).toEqual(expect.any(Array));
  expect(appTestUtil.getRemoteCaptains()?.length).toBeGreaterThan(0);
  const remoteCaptain = appTestUtil.getRemoteCaptains()[0]

  // common before each test initializer for all tests in this group
  beforeEach(async () => {
    await appTestUtil.beforeTestAppInitializer()
  })
  test('"new-remote-services" message sent on successful connection establishment with a captain', async () => {
    const captainServer = remoteCaptainMockUtil.captainServers[remoteCaptain]!
    expect(captainServer).toBeDefined()
    higherOrderUtil.verifyRemoteCaptainReceivedNewRemoteServices(captainServer, 1, 1)
  })
  test('Service Ips checked at "INTERVAL" rate (when there is no state transition)', async () => {
    const webService = appState.getWebService(serviceKey)!
    // Wait for all ips to reach "passing" state
    await higherOrderUtil.waitForAllIpsOfTheServiceToBePassing(webService)
    // min time based on pollingInterval ( extra -1 sec to accommodate minor calc errors )
    const minTimeBetweenRoundRobin = (webService.pollingInterval - 1) * 1000
    // max time based on pollingInterval, readTimeout, connectTimeout ( extra =1 sec to accommodate minor calc errors )
    const maxTimeBetweenRoundRobin = (webService.pollingInterval + webService.readTimeout + webService.connectTimeout + 1) * 1000
    // Now ensure the ips are checked in "INTERVAL" rate as there is no transition
    for(let index=0; index < webService.serviceConf.mate.addresses.length; index += 1) {
      // Clear call counts
      jest.clearAllMocks()
      const [calls, timeSpent] = await commonTestUtil.waitUntilCalled(webService, 'pollSuccessRoundRobin', [MATCH_ANY_VALUE, MATCH_ANY_VALUE], 1, maxTimeBetweenRoundRobin)
      // Expect 'one' call made  between min and max time
      expect(calls.length).toBe(1)
      expect(timeSpent > minTimeBetweenRoundRobin && timeSpent < maxTimeBetweenRoundRobin).toBe(true)
      logger.info('Service Ips checked at "INTERVAL"', {
        noOfCalls: calls.length,
        timeSpent,
        minTimeBetweenRoundRobin,
        maxTimeBetweenRoundRobin,
        spentCorrectTime: timeSpent > minTimeBetweenRoundRobin && timeSpent < maxTimeBetweenRoundRobin,
      })
    }
  })
  test('Service Ips checked in "BULK" simultaneously, when there is state transition', async () => {
    const webService = appState.getWebService(serviceKey)!
    // Wait for all ips to reach "passing" state
    await higherOrderUtil.waitForAllIpsOfTheServiceToBePassing(webService)
    // Fail ip polls using msw mocks
    requestMockUtil.getMswServer().use(
      ...requestMockUtil.failByNetworkErrorResponses([
        ...targetIPs
      ])
    )
    // Clear calls/mock logs
    jest.clearAllMocks()

    // time taken for one poll to finish which included pollinginterval, readtimeout, connnecttimeout
    let timeTaken = (webService.pollingInterval + (webService.readTimeout + webService.connectTimeout + 1 )) * 1000
    // wait for first failure which triggers the "bulk" polling afterwards
    await expect(
      commonTestUtil.waitUntilCalled(
        webService,
        'pollFailedRoundRobin',
        [MATCH_ANY_VALUE],
        1,
        timeTaken
      )
    ).resolves.not.toThrow()

    // 5 or half of all addresses, whichever is lower
    const noOfAddressesToBeScanned = webService.getAddressesCountForBulkPolling()
    // immediate adjacent ips poll ( where only readtimeout and connectimeout handled )
    timeTaken = (webService.readTimeout + webService.connectTimeout + 1 ) * 1000

    // 'noOfAddressesToBeScanned' times 'polls' done in the given short time required for 1 polls in normal case
    await commonTestUtil.passTimeInMillis(timeTaken)
    await expect(
      commonTestUtil.waitUntilCalled(
        webService,
        'pollEachAddress',
        [MATCH_ANY_VALUE],
        noOfAddressesToBeScanned,
        1
      )
    ).resolves.not.toThrow()
  })
  test('Service Ips checked in "BULK" and verification succeeds/confirmed by other ips', async () => {    
    const webService = appState.getWebService(serviceKey)!
    // Wait for all ips to reach "passing" state
    await higherOrderUtil.waitForAllIpsOfTheServiceToBePassing(webService)
    // Fail ip polls using msw mocks
    requestMockUtil.getMswServer().use(
      ...requestMockUtil.failByNetworkErrorResponses([
        ...targetIPs
      ])
    )
    // Clear calls/mock logs
    jest.clearAllMocks()

    // time taken for one poll to finish which included pollinginterval, readtimeout, connnecttimeout
    let timeTaken = (webService.pollingInterval + (webService.readTimeout + webService.connectTimeout + 1 )) * 1000
    // wait for first failure which triggers the "bulk" polling afterwards
    await expect(
      commonTestUtil.waitUntilCalled(
        webService,
        'pollFailedRoundRobin',
        [MATCH_ANY_VALUE],
        1,
        timeTaken
      )
    ).resolves.not.toThrow()

    // 5 or half of all addresses, whichever is lower
    const noOfAddressesToBeScanned = webService.getAddressesCountForBulkPolling()
    // immediate adjacent ips poll ( where only readtimeout and connectimeout handled )
    timeTaken = (webService.readTimeout + webService.connectTimeout + 1 ) * 1000

    // 'noOfAddressesToBeScanned' times 'polls' done in the given short time required for 1 polls in normal case
    await commonTestUtil.passTimeInMillis(timeTaken)
    await expect(
      commonTestUtil.waitUntilCalled(
        webService,
        'pollEachAddress',
        [MATCH_ANY_VALUE],
        noOfAddressesToBeScanned,
        1
      )
    ).resolves.not.toThrow()
    const failedCount =
      Object.keys(webService.serviceState.checks).filter(
        (eachIP) => webService.serviceState.checks[eachIP]?.state === PASS_FAIL_IP_STATES.STATE_DOWN
      )?.length || 0
    // verification succeeds/confirmed by other ips
    expect(failedCount).toBeGreaterThanOrEqual(noOfAddressesToBeScanned + 1)
  })
  test('Service Ips checked in "BULK" and verification fails/un-confirmed by other ips', async () => {
    const webService = appState.getWebService(serviceKey)!
    // Wait for all ips to reach "passing" state
    await higherOrderUtil.waitForAllIpsOfTheServiceToBePassing(webService)
    // only two addresses fail which is not enough to confirm failure as we have other passing ips
    requestMockUtil.getMswServer().use(
      ...requestMockUtil.failByNetworkErrorResponses([
        ...targetIPs.slice(0, 2)
      ])
    )
    // Clear calls/mock logs
    jest.clearAllMocks()

    // time taken for one poll to finish which included pollinginterval, readtimeout, connnecttimeout
    let timeTaken = (webService.pollingInterval + (webService.readTimeout + webService.connectTimeout + 1 )) * 1000
    // wait for first failure which triggers the "bulk" polling afterwards
    await expect(
      commonTestUtil.waitUntilCalled(
        webService,
        'pollFailedRoundRobin',
        [MATCH_ANY_VALUE],
        1,
        timeTaken
      )
    ).resolves.not.toThrow()

    // 5 or half of all addresses, whichever is lower
    const noOfAddressesToBeScanned = webService.getAddressesCountForBulkPolling()
    // immediate adjacent ips poll ( where only readtimeout and connectimeout handled )
    timeTaken = (webService.readTimeout + webService.connectTimeout + 1 ) * 1000

    // 'noOfAddressesToBeScanned' times 'polls' done in the given short time required for 1 polls in normal case
    await commonTestUtil.passTimeInMillis(timeTaken)
    await expect(
      commonTestUtil.waitUntilCalled(
        webService,
        'pollEachAddress',
        [MATCH_ANY_VALUE],
        noOfAddressesToBeScanned,
        1
      )
    ).resolves.not.toThrow()
    const failedCount =
      Object.keys(webService.serviceState.checks).filter(
        (eachIP) => webService.serviceState.checks[eachIP]?.state === PASS_FAIL_IP_STATES.STATE_DOWN
      )?.length || 0
    // verification fails/un-confirmed by other ips
    expect(failedCount).not.toBeGreaterThanOrEqual(noOfAddressesToBeScanned + 1)    
  })
  test('Service Ips checked in "BULK" and "service-state-change" message sent on state change.', async () => {
    const webService = appState.getWebService(serviceKey)!
    // Wait for all ips to reach "passing" state
    await higherOrderUtil.waitForAllIpsOfTheServiceToBePassing(webService)
    // Fail ip polls using msw mocks
    requestMockUtil.getMswServer().use(
      ...requestMockUtil.failByNetworkErrorResponses([
        ...targetIPs
      ])
    )
    // Clear calls/mock logs
    jest.clearAllMocks()

    // time taken for one poll to finish which included pollinginterval, readtimeout, connnecttimeout
    let timeTaken = (webService.pollingInterval + (webService.readTimeout + webService.connectTimeout + 1 )) * 1000
    // wait for first failure which triggers the "bulk" polling afterwards
    await expect(
      commonTestUtil.waitUntilCalled(
        webService,
        'pollFailedRoundRobin',
        [MATCH_ANY_VALUE],
        1,
        timeTaken
      )
    ).resolves.not.toThrow()

    // 5 or half of all addresses, whichever is lower
    const noOfAddressesToBeScanned = webService.getAddressesCountForBulkPolling()
    // immediate adjacent ips poll ( where only readtimeout and connectimeout handled )
    timeTaken = (webService.readTimeout + webService.connectTimeout + 1 ) * 1000

    // 'noOfAddressesToBeScanned' times 'polls' done in the given short time required for 1 polls in normal case
    await commonTestUtil.passTimeInMillis(timeTaken)
    await expect(
      commonTestUtil.waitUntilCalled(
        webService,
        'pollEachAddress',
        [MATCH_ANY_VALUE],
        noOfAddressesToBeScanned,
        1
      )
    ).resolves.not.toThrow()
    const failedCount =
      Object.keys(webService.serviceState.checks).filter(
        (eachIP) => webService.serviceState.checks[eachIP]?.state === PASS_FAIL_IP_STATES.STATE_DOWN
      )?.length || 0
    // verification succeeds/confirmed by other ips
    expect(failedCount).toBeGreaterThanOrEqual(noOfAddressesToBeScanned + 1)
    await commonTestUtil.advanceBothRealAndFakeTime(2000)
    const captainServer = remoteCaptainMockUtil.captainServers[remoteCaptain]!
    expect(captainServer).toBeDefined()
    higherOrderUtil.verifyRemoteCaptainReceivedServiceStateChange(captainServer, 1, 1)    
  })
})
