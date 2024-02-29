// Env setup. Needs to be the first import
import './env/captainTest.env.js'

// Other imports
import console from 'console'
import appConfig from '../src/appConfig.js'
import appState from '../src/appState.js'
import * as WebServiceHelper from '../src/web-service/webServiceHelper.js'
import appTestUtil from './utils/appTest.utils.js'
import requestMockUtil from './utils/requestMock.utils.js'
import commonTestUtil from './utils/commonTest.utils.js'
import remoteCaptainMockUtil from './utils/remoteCaptainMock.utils.js'
import remoteMateMockUtil from './utils/remoteMateMock.utils.js'
import higherOrderUtil from './utils/higherOrderTest.utils.js'
import {NotificationService} from '../src/NotificationService.js'
import {initializeDnsManager} from '../src/dns/dnsManager.js'

const notificationCalls = {
  datadogSuccessCall: jest.fn(),
  datadogFailureCall: jest.fn(),
  slackSuccessCall: jest.fn(),
  slackFailureCall: jest.fn(),
  genericSuccessCall: jest.fn(),
  genericFailureCall: jest.fn(),
}

beforeAll(async () => {
  requestMockUtil.setupMswReqMocks()
  requestMockUtil.getMswServer().listen({
    onUnhandledRequest: 'error',
  })
  requestMockUtil.getMswServer().events.on('request:start', async ({request, requestId}): Promise<void> => {
    const payload = await request.clone().text()
    const url = request.url
    if (`${url}`.startsWith(NotificationService.getDatadogEventUrl()!)) {
      if (payload.includes('DNS record update failed')) {
        notificationCalls.datadogFailureCall(requestId, url, payload)
      } else {
        notificationCalls.datadogSuccessCall(requestId, url, payload)
      }
    }
    if (`${url}`.startsWith(NotificationService.getSlackMessageUrl()!)) {
      if (payload.includes('DNS failover failed')) {
        notificationCalls.slackFailureCall(requestId, url, payload)
      } else {
        notificationCalls.slackSuccessCall(requestId, url, payload)
      }
    }
    if (`${url}`.startsWith(NotificationService.getGenericNotificationUrl()!)) {
      if (payload.includes('Failover unsuccessful')) {
        notificationCalls.genericFailureCall(requestId, url, payload)
      } else {
        notificationCalls.genericSuccessCall(requestId, url, payload)
      }
    }
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
  const serviceKey = 'crm'
  // const serviceKey = 'ecommerce'
  const targetIP = '10.5.0.21'

  // common before each test initializer for all tests in this group
  beforeEach(async () => {
    await appTestUtil.beforeTestAppInitializer()
  })

  test('Checks for healthy ip reaches "rise"', async () => {
    // By default all ips have '200' response, so no additional 'req' mock needed
    const webService = appState.getWebService(serviceKey)!
    await higherOrderUtil.waitForPollToRise(webService, targetIP)
  })
  test('Checks for unHealthy ip reaches "fall"', async () => {
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([targetIP]))
    const webService = appState.getWebService(serviceKey)!
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
  })
  test('Case: In Disaggrement: Verification/aggreement of checks with all remote captain peers needed for declaring an ip as "passing"/"failing"', async () => {
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([targetIP]))
    const webService = appState.getWebService(serviceKey)!
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
    await higherOrderUtil.FAIL_waitForFailOverInit(webService, targetIP)
  })
  test('Case: All in aggrement: Verification/aggreement of checks with all remote captain peers needed for declaring an ip as "passing"/"failing"', async () => {
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([targetIP]))
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: remainingIPs[0]!,
      failing: 0,
      passing: 3,
    })
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
    await higherOrderUtil.waitForFailOverInit(webService, [targetIP])
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [remainingIPs[0]!])
  })
  test('Verification/aggreement of checks with all remote captain peers needed for finding "replacement ip" for "failover"', async () => {
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([targetIP]))
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
    await higherOrderUtil.waitForFailOverInit(webService, [targetIP])
    await higherOrderUtil.FAIL_verifyActiveAndResolvedContain(webService, remainingIPs[0]!)
  })
  test('Reaching "rise"/"fall" needed for declaring an ip as "passing"/"failing"', async () => {
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([remainingIPs[0]!]))
    await higherOrderUtil.waitForPollFailureCount(webService, remainingIPs[0]!, 1)
    await higherOrderUtil.FAIL_verifyAddressProcessed(webService, remainingIPs[0]!)
    await higherOrderUtil.waitForPollFailureCount(webService, remainingIPs[0]!, 2)
    await higherOrderUtil.FAIL_verifyAddressProcessed(webService, remainingIPs[0]!)
    await higherOrderUtil.waitForPollFailureCount(webService, remainingIPs[0]!, 3)
    await higherOrderUtil.verifyAddressProcessed(webService, remainingIPs[0]!)
  })
  test('Leader information broadcast to all remote peers', async () => {
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    // Test all remote-peer clients for having received 'new-leader' notification
    for (const eachCaptain of Object.keys(remoteCaptainMockUtil.mockClientSocketManagers)) {
      const mockClientSocketManager = remoteCaptainMockUtil.mockClientSocketManagers[eachCaptain]!
      await higherOrderUtil.verifyRemoteCaptainReceivedNewLeader(mockClientSocketManager)
    }
  })
  test('Captain peers are kept in sync. Service checks "state" broadcast to all remote peers', async () => {
    const webService = appState.getWebService(serviceKey)!
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    // Test all remote-peer clients for not-having received 'healthCheckNotification' notification
    for (const eachCaptain of Object.keys(remoteCaptainMockUtil.mockClientSocketManagers)) {
      const mockClientSocketManager = remoteCaptainMockUtil.mockClientSocketManagers[eachCaptain]!
      await higherOrderUtil.FAIL_verifyRemoteCaptainReceivedHealthCheckUpdate(mockClientSocketManager)
    }
    await higherOrderUtil.waitForPollToRise(webService, targetIP)
    // Test all remote-peer clients for having received 'healthCheckNotification' notification,
    // with given ip and given 'passing' times value
    for (const eachCaptain of Object.keys(remoteCaptainMockUtil.mockClientSocketManagers)) {
      const mockClientSocketManager = remoteCaptainMockUtil.mockClientSocketManagers[eachCaptain]!
      await higherOrderUtil.verifyRemoteCaptainReceivedHealthCheckUpdate(mockClientSocketManager, {
        ipAddress: targetIP,
        passing: webService.rise,
      })
    }
  })
  test('Service checks "reset" to "zero" on change in health state of an "ip"', async () => {
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([targetIP]))
    const webService = appState.getWebService(serviceKey)!
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
    // change 'failing' to 'passing'
    requestMockUtil.getMswServer().use(...requestMockUtil.passingResponses([targetIP]))
    await higherOrderUtil.waitForPollSuccessCount(webService, targetIP, 1, false)
    await higherOrderUtil.waitForHealthReset(webService, targetIP)
  })
  test('Service checks "reset" when needed is always broadcast to all remote peers', async () => {
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([targetIP]))
    const webService = appState.getWebService(serviceKey)!
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
    // change 'failing' to 'passing'
    requestMockUtil.getMswServer().use(...requestMockUtil.passingResponses([targetIP]))
    await higherOrderUtil.waitForPollSuccessCount(webService, targetIP, 1, false)
    await higherOrderUtil.waitForHealthReset(webService, targetIP)
    // Test all remote-peer clients for having received 'healthCheckNotification' notification,
    // with given ip
    for (const eachCaptain of Object.keys(remoteCaptainMockUtil.mockClientSocketManagers)) {
      const mockClientSocketManager = remoteCaptainMockUtil.mockClientSocketManagers[eachCaptain]!
      await higherOrderUtil.verifyRemoteCaptainReceivedHealthCheckUpdate(mockClientSocketManager, {
        ipAddress: targetIP,
      })
    }
  })
  test('Newly connecting remote peer receives complete state data on successfull initial connection', async () => {
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    // Test all remote-peer to have received 'complete state data' on initial connect
    for (const eachCaptain of Object.keys(remoteCaptainMockUtil.mockClientSocketManagers)) {
      const mockClientSocketManager = remoteCaptainMockUtil.mockClientSocketManagers[eachCaptain]!
      await higherOrderUtil.verifyRemoteCaptainReceivedBulkHealthCheckUpdate(mockClientSocketManager)
    }
  })
})

// Have custom beforeEach initializer for each test
describe('Tests Custom. Primary/Common', () => {
  const serviceKey = 'crm'
  // const serviceKey = 'ecommerce'
  const targetIP = '10.5.0.21'
  test('Only leader can alter zone records or active addresses', async () => {
    await appTestUtil.beforeTestAppInitializer({
      patchedAppConfig: {
        //a). set consul http addr 'undefined' to enable non-HA
        CONSUL_HTTP_ADDR: undefined,
        //b). Alter SELF_URL and CAPTAIN_PORT so as to run test as non-leader peer for this particular test
        //Setting SELF_URL !== MEMBER_URLS[0] will make this non-leader as only first ip is captain
        SELF_URL: appConfig.MEMBER_URLS[1],
        CAPTAIN_PORT: '7402',
      },
    })
    // initialize dns manager to verify resolved address, won't be auto initialized, as this is not a leader instance for this test
    initializeDnsManager()
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([targetIP]))
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: remainingIPs[0]!,
      failing: 0,
      passing: 3,
    })
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
    // address not processed as only leader do that
    await higherOrderUtil.FAIL_verifyAddressProcessed(webService, targetIP)
    await commonTestUtil.advanceBothRealAndFakeTime(2000)
    await higherOrderUtil.FAIL_verifyActiveAndResolvedContain(webService, remainingIPs[0]!)
  })
})

describe('Tests. With multi=false', () => {
  const serviceKey = 'crm'

  // common before each test initializer for all tests in this group
  beforeEach(async () => {
    await appTestUtil.beforeTestAppInitializer()
  })

  test('Case: No-DnsEntry. On bootstrap, first ip from services.yaml, set as activeAddress and updated to dns-provider', async () => {
    const webService = appState.getWebService(serviceKey)!
    const firstIP = webService.serviceConf?.addresses?.[0]
    const targetActiveAddresses = [firstIP!]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Detected unHealthy,active "ip" and initiate failover with the available healthy "ip"', async () => {
    const targetIP = '10.5.0.21'
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([targetIP]))
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const healthyFailoverIP = remainingIPs[0]!
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: healthyFailoverIP,
      failing: 0,
      passing: 3,
    })
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
    await higherOrderUtil.waitForFailOverInit(webService, [targetIP])
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [healthyFailoverIP])
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.DNS_UPDATED)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceHealthy(webService)
  })
  test('Detected unHealthy,active "ip" but failover available at a later point but before "failover" cooldown', async () => {
    const targetIP = '10.5.0.21'
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const laterHealthyFailoverIP = remainingIPs[0]!
    requestMockUtil
      .getMswServer()
      .use(...requestMockUtil.failByNetworkErrorResponses([targetIP, laterHealthyFailoverIP]))
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
    await higherOrderUtil.waitForFailOverInit(webService, [targetIP])
    await higherOrderUtil.FAIL_waitForAddressChangeInit(webService, [laterHealthyFailoverIP])
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [targetIP], false)
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    requestMockUtil.getMswServer().use(...requestMockUtil.passingResponses([laterHealthyFailoverIP]))
    // wait for poll reset
    await higherOrderUtil.waitForHealthReset(webService, laterHealthyFailoverIP)
    jest.clearAllMocks()
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: laterHealthyFailoverIP,
      failing: 0,
      passing: 3,
    })
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    await higherOrderUtil.waitForPollToRise(webService, laterHealthyFailoverIP)
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [laterHealthyFailoverIP])
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.DNS_UPDATED)
  })
  test('Case: Service transition from "healthy" to "unhealthy". Detected unHealthy,active "ip" but no failover "ip" available. Service marked "unhealthy" but zonerecords retained', async () => {
    const targetIP = '10.5.0.21'
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const laterHealthyFailoverIP = remainingIPs[0]!
    requestMockUtil
      .getMswServer()
      .use(...requestMockUtil.failByNetworkErrorResponses([targetIP, laterHealthyFailoverIP]))
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
    await higherOrderUtil.waitForFailOverInit(webService, [targetIP])
    await higherOrderUtil.FAIL_waitForAddressChangeInit(webService, [laterHealthyFailoverIP])
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [targetIP], false)
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceUnHealthy(webService)
  })
  test('Case: Service transition from "unhealthy" to "healthy". Detected unHealthy,active "ip" but failover available at a later point (after failover cooldown and "failed" notification)', async () => {
    //transition to unhealthy
    const targetIP = '10.5.0.21'
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const laterHealthyFailoverIP = remainingIPs[0]!
    requestMockUtil
      .getMswServer()
      .use(...requestMockUtil.failByNetworkErrorResponses([targetIP, laterHealthyFailoverIP]))
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderUtil.waitForPollToFall(webService, targetIP)
    await higherOrderUtil.waitForFailOverInit(webService, [targetIP])
    await higherOrderUtil.FAIL_waitForAddressChangeInit(webService, [laterHealthyFailoverIP])
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [targetIP], false)
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceUnHealthy(webService)

    // transition to healthy
    requestMockUtil.getMswServer().use(...requestMockUtil.passingResponses([laterHealthyFailoverIP]))
    jest.clearAllMocks()
    // wait for poll reset
    await higherOrderUtil.waitForHealthReset(webService, laterHealthyFailoverIP)
    await higherOrderUtil.waitForPollToRise(webService, laterHealthyFailoverIP)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: laterHealthyFailoverIP,
      failing: 0,
      passing: 3,
    })
    console.log('jest.clearAllMocks:after:2', (webService.pollSuccess as any)?.mock?.calls)
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [laterHealthyFailoverIP])
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.DNS_UPDATED)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceHealthy(webService)
  })
})

// Have custom beforeEach initializer for each test
describe('Tests Custom. With multi=false', () => {
  const serviceKey = 'crm'
  const zoneRecord = 'crm.ops'
  test('Case: Existing-DnsEntry. Prefer existing dns-server entries. On bootstrap, existing dns record set as "active" address of webService', async () => {
    const targetIP = '10.5.0.22'
    await appTestUtil.beforeTestAppInitializer({
      existingDnsRecords: [{zoneRecord: zoneRecord, ipAddresses: [targetIP]}],
    })
    const webService = appState.getWebService(serviceKey)!
    const targetActiveAddresses = [targetIP]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Case: Existing-DnsEntry but is an unKnown "ip". On bootstrap, first ip from services.yaml, set as activeAddress and synced(unKnown removed) to dns-provider', async () => {
    const unknownIP = '10.5.0.222'
    await appTestUtil.beforeTestAppInitializer({
      existingDnsRecords: [{zoneRecord: zoneRecord, ipAddresses: [unknownIP]}],
    })
    const webService = appState.getWebService(serviceKey)!
    const firstIP = webService.serviceConf?.addresses?.[0]
    const targetActiveAddresses = [firstIP!]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
})

describe('Tests. With multi=true', () => {
  const serviceKey = 'ecommerce'

  // common before each test initializer for all tests in this group
  beforeEach(async () => {
    await appTestUtil.beforeTestAppInitializer()
  })

  test('Case: No-DnsEntries. On Bootstrap, all ips from services.yaml, set as activeAddresses and updated to dns-provider', async () => {
    const webService = appState.getWebService(serviceKey)!
    const targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Detect unHealthy, active "ip" and remove from activeAddresses and also the zone records', async () => {
    const webService = appState.getWebService(serviceKey)!
    const unHealthyIP = webService.serviceConf?.addresses?.[0]!
    let targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([unHealthyIP]))
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: unHealthyIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderUtil.waitForPollToFall(webService, unHealthyIP)
    await higherOrderUtil.verifyAddressProcessed(webService, unHealthyIP)
    targetActiveAddresses = [...webService.serviceConf?.addresses?.filter((eachAddress) => eachAddress !== unHealthyIP)]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Remain healthy as long as atleast one active ip remains', async () => {
    const webService = appState.getWebService(serviceKey)!
    const unHealthyIPs = webService.serviceConf?.addresses?.slice(1)
    let targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses(unHealthyIPs))
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    for (const unHealthyIP of unHealthyIPs) {
      remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
        ipAddress: unHealthyIP,
        failing: 3,
        passing: 0,
      })
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderUtil.waitForPollToFall(webService, unHealthyIP)
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderUtil.verifyAddressProcessed(webService, unHealthyIP)
    }
    targetActiveAddresses = [
      ...webService.serviceConf?.addresses?.filter((eachAddress) => !unHealthyIPs.includes(eachAddress)),
    ]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    expect(webService.isFailOverInProgress()).toBe(false)
    expect(webService.serviceState.status).toBe(WebServiceHelper.WEB_SERVICE_STATUS.HEALTHY)
  })
  test('Detect healthy, non-active "ip" and add to activeAddresses and also to zone records', async () => {
    const webService = appState.getWebService(serviceKey)!
    const unHealthyIP1 = webService.serviceConf?.addresses?.[0]!
    const unHealthyIP2 = webService.serviceConf?.addresses?.[1]!
    let unHealthyIPs = [unHealthyIP1, unHealthyIP2]
    let targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses(unHealthyIPs))
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    for (const unHealthyIP of unHealthyIPs) {
      remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
        ipAddress: unHealthyIP,
        failing: 3,
        passing: 0,
      })
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderUtil.waitForPollToFall(webService, unHealthyIP)
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderUtil.verifyAddressProcessed(webService, unHealthyIP)
    }
    targetActiveAddresses = [
      ...webService.serviceConf?.addresses?.filter((eachAddress) => !unHealthyIPs.includes(eachAddress)),
    ]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    //detect healthy ip back
    requestMockUtil.getMswServer().use(...requestMockUtil.passingResponses([unHealthyIP2]))
    unHealthyIPs = unHealthyIPs.filter((eachAddress) => eachAddress !== unHealthyIP2)
    // wait for poll reset
    await higherOrderUtil.waitForHealthReset(webService, unHealthyIP2)
    jest.clearAllMocks()
    await higherOrderUtil.waitForPollToRise(webService, unHealthyIP2)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: unHealthyIP2,
      failing: 0,
      passing: 3,
    })
    targetActiveAddresses = [
      ...webService.serviceConf?.addresses?.filter((eachAddress) => !unHealthyIPs.includes(eachAddress)),
    ]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Case: Service transition from "healthy" to "unhealthy". All active ips become unhealthy. Service marked "unhealthy" but the last one "ip" retained in zone records', async () => {
    const webService = appState.getWebService(serviceKey)!
    const unHealthyIPs = webService.serviceConf?.addresses?.slice(0)
    let targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    jest.clearAllMocks()
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses(unHealthyIPs))
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    for (const unHealthyIP of unHealthyIPs) {
      remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
        ipAddress: unHealthyIP,
        failing: 3,
        passing: 0,
      })
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderUtil.waitForPollToFall(webService, unHealthyIP)
    }
    await higherOrderUtil.waitForFailOverInit(webService, unHealthyIPs)
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceUnHealthy(webService)
    // one ip retained, even though service unHealthy
    await higherOrderUtil.verifyActiveAndResolvedAddressCount(webService, 1, false)
  })
  test('Case: Service transition from "unhealthy" to "healthy". Healthy "ips" become available one by one and everything gets added to activeAddress list and also to zone records', async () => {
    const webService = appState.getWebService(serviceKey)!
    const unHealthyIPs = webService.serviceConf?.addresses?.slice(0)
    let targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    jest.clearAllMocks()
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses(unHealthyIPs))
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    for (const unHealthyIP of unHealthyIPs) {
      remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
        ipAddress: unHealthyIP,
        failing: 3,
        passing: 0,
      })
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderUtil.waitForPollToFall(webService, unHealthyIP)
    }
    await higherOrderUtil.waitForFailOverInit(webService, unHealthyIPs)
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    commonTestUtil.advanceBothRealAndFakeTime(5000)
    // one ip retained, even though service unHealthy
    await higherOrderUtil.verifyActiveAndResolvedAddressCount(webService, 1, false)
    // healthy ip becomes available
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceUnHealthy(webService)
    // transition to healthy
    const laterHealthyFailoverIP = unHealthyIPs[0]!
    requestMockUtil.getMswServer().use(...requestMockUtil.passingResponses([laterHealthyFailoverIP]))
    jest.clearAllMocks()
    // wait for poll reset
    await higherOrderUtil.waitForHealthReset(webService, laterHealthyFailoverIP)
    await higherOrderUtil.waitForPollToRise(webService, laterHealthyFailoverIP)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: laterHealthyFailoverIP,
      failing: 0,
      passing: 3,
    })
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [laterHealthyFailoverIP])
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.DNS_UPDATED)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceHealthy(webService)
  })
})

// Have custom beforeEach initializer for each test
describe('Tests Custom. With multi=true', () => {
  const serviceKey = 'ecommerce'
  const zoneRecord = 'ecommerce.ops'
  test('Case: Existing-Subset-Of-DnsEntries. On Bootstrap, all ips from services.yaml, set as activeAddresses and synced with dns-provider', async () => {
    const targetIP = '10.5.0.32'
    await appTestUtil.beforeTestAppInitializer({
      existingDnsRecords: [{zoneRecord: zoneRecord, ipAddresses: [targetIP]}],
    })
    const webService = appState.getWebService(serviceKey)!
    const targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Case: Existing-UnKnown-DnsEntries. On Bootstrap, all ips from services.yaml, set as activeAddresses and synced (unknowns removed) with dns-provider', async () => {
    const unKnownTargetIP1 = '10.5.0.123'
    const unKnownTargetIP2 = '10.5.0.124'
    await appTestUtil.beforeTestAppInitializer({
      existingDnsRecords: [{zoneRecord: zoneRecord, ipAddresses: [unKnownTargetIP1, unKnownTargetIP2]}],
    })
    const webService = appState.getWebService(serviceKey)!
    const targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderUtil.waitForAddressChangeInit(webService, targetActiveAddresses)
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Case: Existing-Subset-Plus-UnKnown-DnsEntries. On Bootstrap, all ips from services.yaml, set as activeAddresses and synced (add/remove) with dns-provider', async () => {
    const knownTargetIP1 = '10.5.0.31'
    const unKnownTargetIP2 = '10.5.0.124'
    await appTestUtil.beforeTestAppInitializer({
      existingDnsRecords: [{zoneRecord: zoneRecord, ipAddresses: [knownTargetIP1, unKnownTargetIP2]}],
    })
    const webService = appState.getWebService(serviceKey)!
    const targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
})

// HA and notification related tests
describe('Notification tests', () => {
  const serviceKey = 'crm'

  // common before each test initializer for all tests in this group
  beforeEach(async () => {
    jest.clearAllMocks()
    await appTestUtil.beforeTestAppInitializer()
  })

  test('Success Notifications. Detected unHealthy,active "ip" and initiate failover with the available healthy "ip"', async () => {
    const firstAndActiveIP = '10.5.0.21' // firstIP set as active on startup, so it is already active
    requestMockUtil.getMswServer().use(...requestMockUtil.failByNetworkErrorResponses([firstAndActiveIP]))
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== firstAndActiveIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const healthyFailoverIP = remainingIPs[0]!
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: firstAndActiveIP,
      failing: 3,
      passing: 0,
    })
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: healthyFailoverIP,
      failing: 0,
      passing: 3,
    })
    await higherOrderUtil.waitForPollToFall(webService, firstAndActiveIP)
    await higherOrderUtil.waitForFailOverInit(webService, [firstAndActiveIP])
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [healthyFailoverIP])
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.DNS_UPDATED)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceHealthy(webService)
    expect(notificationCalls.datadogSuccessCall).toHaveBeenCalledTimes(1)
    expect(notificationCalls.slackSuccessCall).toHaveBeenCalledTimes(1)
    expect(notificationCalls.genericSuccessCall).toHaveBeenCalledTimes(1)
  })

  test('Failure Notifications. Service transition from "healthy" to "unhealthy". Detected unHealthy,active "ip" but no failover "ip" available. Service marked "unhealthy" but zonerecords retained', async () => {
    const firstAndActiveIP = '10.5.0.21' // firstIP set as active on startup, so it is already active
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== firstAndActiveIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const laterHealthyFailoverIP = remainingIPs[0]!
    requestMockUtil
      .getMswServer()
      .use(...requestMockUtil.failByNetworkErrorResponses([firstAndActiveIP, laterHealthyFailoverIP]))
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: firstAndActiveIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderUtil.waitForPollToFall(webService, firstAndActiveIP)
    await higherOrderUtil.waitForFailOverInit(webService, [firstAndActiveIP])
    await higherOrderUtil.FAIL_waitForAddressChangeInit(webService, [laterHealthyFailoverIP])
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [firstAndActiveIP], false)
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceUnHealthy(webService)
    expect(notificationCalls.datadogFailureCall).toHaveBeenCalledTimes(1)
    expect(notificationCalls.slackFailureCall).toHaveBeenCalledTimes(1)
    expect(notificationCalls.genericFailureCall).toHaveBeenCalledTimes(1)
  })

  test('Dual Notification, first "failure" and then "success" at a later time. Service transition from "unhealthy" to "healthy". Detected unHealthy,active "ip" but failover available at a later point (after failover cooldown and "failed" notification)', async () => {
    //transition to unhealthy
    const firstAndActiveIP = '10.5.0.21' // firstIP set as active on startup, so it is already active
    const webService = appState.getWebService(serviceKey)!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== firstAndActiveIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const laterHealthyFailoverIP = remainingIPs[0]!
    requestMockUtil
      .getMswServer()
      .use(...requestMockUtil.failByNetworkErrorResponses([firstAndActiveIP, laterHealthyFailoverIP]))
    await commonTestUtil.advanceBothRealAndFakeTime(1000)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: firstAndActiveIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderUtil.waitForPollToFall(webService, firstAndActiveIP)
    await higherOrderUtil.waitForFailOverInit(webService, [firstAndActiveIP])
    await higherOrderUtil.FAIL_waitForAddressChangeInit(webService, [laterHealthyFailoverIP])
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [firstAndActiveIP], false)
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceUnHealthy(webService)
    expect(notificationCalls.datadogFailureCall).toHaveBeenCalledTimes(1)
    expect(notificationCalls.slackFailureCall).toHaveBeenCalledTimes(1)
    expect(notificationCalls.genericFailureCall).toHaveBeenCalledTimes(1)

    // transition to healthy
    requestMockUtil.getMswServer().use(...requestMockUtil.passingResponses([laterHealthyFailoverIP]))
    jest.clearAllMocks()
    // wait for poll reset
    await higherOrderUtil.waitForHealthReset(webService, laterHealthyFailoverIP)
    await higherOrderUtil.waitForPollToRise(webService, laterHealthyFailoverIP)
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: laterHealthyFailoverIP,
      failing: 0,
      passing: 3,
    })
    await higherOrderUtil.verifyActiveAndResolvedAddresses(webService, [laterHealthyFailoverIP])
    higherOrderUtil.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.DNS_UPDATED)
    await higherOrderUtil.waitForCoolDownAndVerifyServiceHealthy(webService)
    expect(notificationCalls.datadogSuccessCall).toHaveBeenCalledTimes(1)
    expect(notificationCalls.slackSuccessCall).toHaveBeenCalledTimes(1)
    expect(notificationCalls.genericSuccessCall).toHaveBeenCalledTimes(1)
  })
})

describe('Leadership tests', () => {
  // HA mode used by default
  test('HA Test leader=true', async () => {
    await appTestUtil.beforeTestAppInitializer()
    expect(appState.isLeader()).toBe(true)
  })
  test('HA Test leader=false', async () => {
    requestMockUtil.getMswServer().use(requestMockUtil.mockLeaderShipFalseResponse())
    await appTestUtil.beforeTestAppInitializer()
    expect(appState.isLeader()).toBe(false)
  })
  test('HA Test "fallback" election process, when consul service configured but unavailable', async () => {
    requestMockUtil.getMswServer().use(requestMockUtil.mockLeaderShipConsulUnavailable())
    await appTestUtil.beforeTestAppInitializer()
    expect(appState.isLeader()).toBe(true)
  })
  test('non-HA Test leader=true', async () => {
    await appTestUtil.beforeTestAppInitializer({
      patchedAppConfig: {
        //a). set consul http addr 'undefined' to enable non-HA
        CONSUL_HTTP_ADDR: undefined,
      },
    })
    expect(appState.isLeader()).toBe(true)
  })
  test('non-HA Test leader=false', async () => {
    await appTestUtil.beforeTestAppInitializer({
      patchedAppConfig: {
        //a). set consul http addr 'undefined' to enable non-HA
        CONSUL_HTTP_ADDR: undefined,
        //b). Alter SELF_URL and CAPTAIN_PORT so as to run test as non-leader peer for this particular test
        //Setting SELF_URL !== MEMBER_URLS[0] will make this non-leader as only first ip is captain
        SELF_URL: appConfig.MEMBER_URLS[1],
        CAPTAIN_PORT: '7402',
      },
    })
    expect(appState.isLeader()).toBe(false)
  })
})

describe('Remote web service tests', () => {
  const serviceKey = 'forum-app'
  const targetIP = '10.5.0.121'
  const targetMateID = remoteMateMockUtil.getMateIDs()[0]!
  const secondMateID = remoteMateMockUtil.getMateIDs()[1]!

  // common before each test initializer for all tests in this group
  beforeEach(async () => {
    jest.clearAllMocks()
  })

  test('Case: Leader. Receives remote services. Broadcast them to peers. Registers them for polling', async () => {
    await appTestUtil.beforeTestAppInitializer()
    // Remote service, so won't be available on boot
    expect(appState.getWebService(serviceKey)).toBeUndefined()
    await remoteMateMockUtil.emitNewRemoteServicesFromGivenMates([targetMateID])
    // Service registered on message from mate
    await higherOrderUtil.waitUntilServiceRegistered(serviceKey)
    expect(appState.getWebService(serviceKey)).toBeDefined()
    // All captain peers received the copy of the sevices ( broadcast )
    for (const eachCaptain of Object.keys(remoteCaptainMockUtil.mockClientSocketManagers)) {
      const mockClientSocketManager = remoteCaptainMockUtil.mockClientSocketManagers[eachCaptain]!
      await higherOrderUtil.verifyRemoteCaptainReceivedNewRemoteServices(mockClientSocketManager)
    }
  })

  test('Case: Non-Leader. Receives remote services. Send it to the leader ( who will handle broadcasting ). Registers them for polling', async () => {
    const leaderUrl = appConfig.MEMBER_URLS[0] // first is the leader in non-HA
    const selfUrl = appConfig.MEMBER_URLS[1]
    await appTestUtil.beforeTestAppInitializer({
      patchedAppConfig: {
        //a). set consul http addr 'undefined' to enable non-HA
        CONSUL_HTTP_ADDR: undefined,
        //b). Alter SELF_URL and CAPTAIN_PORT so as to run test as non-leader-captain peer for this particular test
        //Setting SELF_URL !== MEMBER_URLS[0] will make this non-leader-captain as only first ip is captain
        SELF_URL: selfUrl,
        CAPTAIN_PORT: '7402',
      },
    })
    appState.setLeaderUrl(leaderUrl)
    // Remote service, so won't be available on boot
    expect(appState.getWebService(serviceKey)).toBeUndefined()
    await remoteMateMockUtil.emitNewRemoteServicesFromGivenMates([targetMateID])
    // Service registered on message from mate
    await higherOrderUtil.waitUntilServiceRegistered(serviceKey)
    expect(appState.getWebService(serviceKey)).toBeDefined()
    // Non-leader only sends it to the leader
    for (const eachCaptain of Object.keys(remoteCaptainMockUtil.mockClientSocketManagers)) {
      const mockClientSocketManager = remoteCaptainMockUtil.mockClientSocketManagers[eachCaptain]!
      if (eachCaptain === leaderUrl) {
        // Non-leader only sends it to the leader
        await higherOrderUtil.verifyRemoteCaptainReceivedNewRemoteServices(mockClientSocketManager)
      } else {
        // Other captain peers won't receive it from this captain
        await higherOrderUtil.FAIL_verifyRemoteCaptainReceivedNewRemoteServices(mockClientSocketManager)
      }
    }
  })

  test('Configuration for the same remote service from multiple/different "mates" are merged together', async () => {
    await appTestUtil.beforeTestAppInitializer()
    // Remote service, so won't be available on boot
    expect(appState.getWebService(serviceKey)).toBeUndefined()
    await remoteMateMockUtil.emitNewRemoteServicesFromGivenMates([targetMateID])
    // Service registered on message from mate
    await higherOrderUtil.waitUntilServiceRegistered(serviceKey, ['10.5.0.121'])
    // Ensure, the ip from second mate is not available before the second mate sends message
    await higherOrderUtil.FAIL_waitUntilServiceRegistered(serviceKey, ['10.5.0.121', '10.5.0.161'])
    // Emit from second mate
    await remoteMateMockUtil.emitNewRemoteServicesFromGivenMates([secondMateID])
    // Expect service to contain both ips
    await higherOrderUtil.waitUntilServiceRegistered(serviceKey, ['10.5.0.121', '10.5.0.161'])
  })

  test('Remote services are polled until "rise"/"fall" only', async () => {
    await appTestUtil.beforeTestAppInitializer()
    // Remote service, so won't be available on boot
    expect(appState.getWebService(serviceKey)).toBeUndefined()
    await remoteMateMockUtil.emitNewRemoteServicesFromGivenMates([targetMateID!])
    // Service registered on message from mate
    await higherOrderUtil.waitUntilServiceRegistered(serviceKey, [targetIP])
    const webService = appState.getWebService(serviceKey)!
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 0,
      passing: webService.rise,
    })
    await higherOrderUtil.waitForPollCount(webService, targetIP, webService.rise)
    // Poll count doesn't go beyond 'webService.rise'
    await higherOrderUtil.FAIL_waitForPollCount(webService, targetIP, webService.rise * 2)
  })

  test('Restart paused polling on "service-state-change"', async () => {
    await appTestUtil.beforeTestAppInitializer()
    // Remote service, so won't be available on boot
    expect(appState.getWebService(serviceKey)).toBeUndefined()
    await remoteMateMockUtil.emitNewRemoteServicesFromGivenMates([targetMateID])
    // Service registered on message from mate
    await higherOrderUtil.waitUntilServiceRegistered(serviceKey, [targetIP])
    const webService = appState.getWebService(serviceKey)!
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 0,
      passing: webService.rise,
    })
    await higherOrderUtil.waitForPollCount(webService, targetIP, webService.rise)
    // Poll count doesn't go beyond 'webService.rise'
    await higherOrderUtil.FAIL_waitForPollCount(webService, targetIP, webService.rise * 2)
    // Send "service-state-change" request
    remoteMateMockUtil.emitServiceStateChangeMessageFromGivenMates([targetMateID], serviceKey, 2, 2)
    // After "service-state-change" request, polling continuous again from start thereby, poll count will * 2
    await higherOrderUtil.waitForPollCount(webService, targetIP, webService.rise * 2)
  })

  test('On "mate-disconnected", mark service "orphan" and do "local-service like" continuous polling', async () => {
    await appTestUtil.beforeTestAppInitializer({
      // Using fake timers creates 'ping timeout' socket.io handshake issue
      // Timeout is important in mate tests as it will trigger 'disconnect-remote-services' message, so using real time
      additionalOptions: {useFakeTimer: false},
    })
    // Remote service, so won't be available on boot
    expect(appState.getWebService(serviceKey)).toBeUndefined()
    await remoteMateMockUtil.emitNewRemoteServicesFromGivenMates([targetMateID])
    // Service registered on message from mate
    await higherOrderUtil.waitUntilServiceRegistered(serviceKey, [targetIP])
    const webService = appState.getWebService(serviceKey)!
    remoteCaptainMockUtil.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 0,
      passing: webService.rise,
    })
    await higherOrderUtil.waitForPollCount(webService, targetIP, webService.rise)
    // Poll count doesn't go beyond 'webService.rise'
    jest.clearAllMocks()
    await higherOrderUtil.FAIL_waitForPollCount(webService, targetIP, 1)
    // Disconnect mate
    await remoteMateMockUtil.disconnectClients([targetMateID])
    jest.clearAllMocks()
    // After mate disconnection, polling continuous like local services
    await higherOrderUtil.waitForPollCount(webService, targetIP, webService.rise)
  })
})
