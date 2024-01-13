// Env setup. Needs to be the first import
import './env/pollingTest.env.js'

// Other imports
import console from 'console'
import appConfig from '../src/appConfig.js'
import appState from '../src/appState.js'
import * as WebServiceHelper from '../src/web-service/webServiceHelper.js'
import webAppTest from './utils/webAppTest.utils.js'
import commonTest from './utils/commonTest.utils.js'
import socketMockTest from './utils/socketMockTest.utils.js'
import higherOrderTest from './utils/higherOrderTest.utils.js'

beforeAll(async () => {
  webAppTest.setupMswReqMocks()
  webAppTest.getMswServer().listen({
    onUnhandledRequest: 'error',
  })
})

afterEach(async () => {
  await webAppTest.cleanAndReset()
})

afterAll(async () => {
  webAppTest.getMswServer().close()
})

jest.setTimeout(700000)

describe('Tests. Primary/Common', () => {
  const serviceKey = 'crm.ops'
  // const serviceKey = 'ecommerce.ops'
  const targetIP = '10.5.0.21'

  // common before each test initializer for all tests in this group
  beforeEach(async () => {
    await webAppTest.beforeTestAppInitializer()
  })

  test('Checks for healthy ip reaches "rise"', async () => {
    // By default all ips have '200' response, so no additional 'req' mock needed
    const webService = appState.webServices[serviceKey]!
    await higherOrderTest.waitForPollToRise(webService, targetIP)
  })
  test('Checks for unHealthy ip reaches "fall"', async () => {
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
    const webService = appState.webServices[serviceKey]!
    await higherOrderTest.waitForPollToFall(webService, targetIP)
  })
  test('Case: In Disaggrement: Verification/aggreement of checks with all remote captain peers needed for declaring an ip as "passing"/"failing"', async () => {
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
    const webService = appState.webServices[serviceKey]!
    await higherOrderTest.waitForPollToFall(webService, targetIP)
    await higherOrderTest.FAIL_waitForFailOverInit(webService, targetIP)
  })
  test('Case: All in aggrement: Verification/aggreement of checks with all remote captain peers needed for declaring an ip as "passing"/"failing"', async () => {
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
    const webService = appState.webServices[serviceKey]!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    await commonTest.advanceBothRealAndFakeTime(1000)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: remainingIPs[0]!,
      failing: 0,
      passing: 3,
    })
    await higherOrderTest.waitForPollToFall(webService, targetIP)
    await higherOrderTest.waitForFailOverInit(webService, [targetIP])
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, [remainingIPs[0]!])
  })
  test('Verification/aggreement of checks with all remote captain peers needed for finding "replacement ip" for "failover"', async () => {
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
    const webService = appState.webServices[serviceKey]!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    await commonTest.advanceBothRealAndFakeTime(1000)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderTest.waitForPollToFall(webService, targetIP)
    await higherOrderTest.waitForFailOverInit(webService, [targetIP])
    await higherOrderTest.FAIL_verifyActiveAndResolvedContain(webService, remainingIPs[0]!)
  })
  test('Reaching "rise"/"fall" needed for declaring an ip as "passing"/"failing"', async () => {
    const webService = appState.webServices[serviceKey]!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([remainingIPs[0]!]))
    await higherOrderTest.waitForPollFailureCount(webService, remainingIPs[0]!, 1)
    await higherOrderTest.FAIL_verifyAddressProcessed(webService, remainingIPs[0]!)
    await higherOrderTest.waitForPollFailureCount(webService, remainingIPs[0]!, 2)
    await higherOrderTest.FAIL_verifyAddressProcessed(webService, remainingIPs[0]!)
    await higherOrderTest.waitForPollFailureCount(webService, remainingIPs[0]!, 3)
    await higherOrderTest.verifyAddressProcessed(webService, remainingIPs[0]!)
  })
  test('Leader information broadcast to all remote peers', async () => {
    await commonTest.advanceBothRealAndFakeTime(1000)
    // Test all remote-peer clients for having received 'new-leader' notification
    for (const eachCaptain of Object.keys(socketMockTest.mockClientSocketManagers)) {
      const mockClientSocketManager = socketMockTest.mockClientSocketManagers[eachCaptain]!
      await higherOrderTest.verifyRemoteCaptainReceivedNewLeader(mockClientSocketManager)
    }
  })
  test('Captain peers are kept in sync. Service checks "state" broadcast to all remote peers', async () => {
    const webService = appState.webServices[serviceKey]!
    await commonTest.advanceBothRealAndFakeTime(1000)
    // Test all remote-peer clients for not-having received 'healthCheckNotification' notification
    for (const eachCaptain of Object.keys(socketMockTest.mockClientSocketManagers)) {
      const mockClientSocketManager = socketMockTest.mockClientSocketManagers[eachCaptain]!
      await higherOrderTest.FAIL_verifyRemoteCaptainReceivedHealthCheckUpdate(mockClientSocketManager)
    }
    await higherOrderTest.waitForPollToRise(webService, targetIP)
    // Test all remote-peer clients for having received 'healthCheckNotification' notification,
    // with given ip and given 'passing' times value
    for (const eachCaptain of Object.keys(socketMockTest.mockClientSocketManagers)) {
      const mockClientSocketManager = socketMockTest.mockClientSocketManagers[eachCaptain]!
      await higherOrderTest.verifyRemoteCaptainReceivedHealthCheckUpdate(mockClientSocketManager, {
        ipAddress: targetIP,
        passing: webService.rise,
      })
    }
  })
  test('Service checks "reset" to "zero" on change in health state of an "ip"', async () => {
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
    const webService = appState.webServices[serviceKey]!
    await higherOrderTest.waitForPollToFall(webService, targetIP)
    // change 'failing' to 'passing'
    webAppTest.getMswServer().use(...webAppTest.passingResponses([targetIP]))
    await higherOrderTest.waitForPollSuccessCount(webService, targetIP, 1, false)
    await higherOrderTest.waitForHealthReset(webService, targetIP)
  })
  test('Service checks "reset" when needed is always broadcast to all remote peers', async () => {
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
    const webService = appState.webServices[serviceKey]!
    await higherOrderTest.waitForPollToFall(webService, targetIP)
    // change 'failing' to 'passing'
    webAppTest.getMswServer().use(...webAppTest.passingResponses([targetIP]))
    await higherOrderTest.waitForPollSuccessCount(webService, targetIP, 1, false)
    await higherOrderTest.waitForHealthReset(webService, targetIP)
    // Test all remote-peer clients for having received 'healthCheckNotification' notification,
    // with given ip
    for (const eachCaptain of Object.keys(socketMockTest.mockClientSocketManagers)) {
      const mockClientSocketManager = socketMockTest.mockClientSocketManagers[eachCaptain]!
      await higherOrderTest.verifyRemoteCaptainReceivedHealthCheckUpdate(mockClientSocketManager, {
        ipAddress: targetIP,
      })
    }
  })
  test('Newly connecting remote peer receives complete state data on successfull initial connection', async () => {
    await commonTest.advanceBothRealAndFakeTime(1000)
    // Test all remote-peer to have received 'complete state data' on initial connect
    for (const eachCaptain of Object.keys(socketMockTest.mockClientSocketManagers)) {
      const mockClientSocketManager = socketMockTest.mockClientSocketManagers[eachCaptain]!
      await higherOrderTest.verifyRemoteCaptainReceivedBulkHealthCheckUpdate(mockClientSocketManager)
    }
  })
})

// Have custom beforeEach initializer for each test
describe('Tests Custom. Primary/Common', () => {
  const serviceKey = 'crm.ops'
  // const serviceKey = 'ecommerce.ops'
  const targetIP = '10.5.0.21'
  test('Only leader can alter zone records or active addresses', async () => {
    //Alter SELF_URL and CAPTAIN_PORT so as to run test as non-captain peer for this particular test
    //Setting SELF_URL !== MEMBER_URLS[0] will make this non-captain as only first ip is captain
    await webAppTest.beforeTestAppInitializer({
      patchedAppConfig: {
        SELF_URL: appConfig.MEMBER_URLS[1],
        CAPTAIN_PORT: '7402',
      },
    })
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
    const webService = appState.webServices[serviceKey]!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    await commonTest.advanceBothRealAndFakeTime(1000)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: remainingIPs[0]!,
      failing: 0,
      passing: 3,
    })
    await higherOrderTest.waitForPollToFall(webService, targetIP)
    // address not processed as only leader do that
    await higherOrderTest.FAIL_verifyAddressProcessed(webService, targetIP)
    await commonTest.advanceBothRealAndFakeTime(2000)
    await higherOrderTest.FAIL_verifyActiveAndResolvedContain(webService, remainingIPs[0]!)
  })
})

describe('Tests. With multi=false', () => {
  const serviceKey = 'crm.ops'

  // common before each test initializer for all tests in this group
  beforeEach(async () => {
    await webAppTest.beforeTestAppInitializer()
  })

  test('Case: No-DnsEntry. On bootstrap, first ip from services.yaml, set as activeAddress and updated to dns-provider', async () => {
    const webService = appState.webServices[serviceKey]!
    const firstIP = webService.serviceConf?.addresses?.[0]
    const targetActiveAddresses = [firstIP!]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Detected unHealthy,active "ip" and initiate failover with the available healthy "ip"', async () => {
    const targetIP = '10.5.0.21'
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP]))
    const webService = appState.webServices[serviceKey]!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const healthyFailoverIP = remainingIPs[0]!
    await commonTest.advanceBothRealAndFakeTime(1000)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: healthyFailoverIP,
      failing: 0,
      passing: 3,
    })
    await higherOrderTest.waitForPollToFall(webService, targetIP)
    await higherOrderTest.waitForFailOverInit(webService, [targetIP])
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, [healthyFailoverIP])
    higherOrderTest.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.DNS_UPDATED)
    await higherOrderTest.waitForCoolDownAndVerifyServiceHealthy(webService)
  })
  test('Detected unHealthy,active "ip" but failover available at a later point but before "failover" cooldown', async () => {
    const targetIP = '10.5.0.21'
    const webService = appState.webServices[serviceKey]!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const laterHealthyFailoverIP = remainingIPs[0]!
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP, laterHealthyFailoverIP]))
    await commonTest.advanceBothRealAndFakeTime(1000)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderTest.waitForPollToFall(webService, targetIP)
    await higherOrderTest.waitForFailOverInit(webService, [targetIP])
    await higherOrderTest.FAIL_waitForAddressChangeInit(webService, [laterHealthyFailoverIP])
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, [targetIP], false)
    higherOrderTest.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    webAppTest.getMswServer().use(...webAppTest.passingResponses([laterHealthyFailoverIP]))
    // wait for poll reset
    await higherOrderTest.waitForHealthReset(webService, laterHealthyFailoverIP)
    jest.clearAllMocks()
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: laterHealthyFailoverIP,
      failing: 0,
      passing: 3,
    })
    await commonTest.advanceBothRealAndFakeTime(1000)
    await higherOrderTest.waitForPollToRise(webService, laterHealthyFailoverIP)
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, [laterHealthyFailoverIP])
    higherOrderTest.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.DNS_UPDATED)
  })
  test('Case: Service transition from "healthy" to "unhealthy". Detected unHealthy,active "ip" but no failover "ip" available. Service marked "unhealthy" but zonerecords retained', async () => {
    const targetIP = '10.5.0.21'
    const webService = appState.webServices[serviceKey]!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const laterHealthyFailoverIP = remainingIPs[0]!
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP, laterHealthyFailoverIP]))
    await commonTest.advanceBothRealAndFakeTime(1000)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderTest.waitForPollToFall(webService, targetIP)
    await higherOrderTest.waitForFailOverInit(webService, [targetIP])
    await higherOrderTest.FAIL_waitForAddressChangeInit(webService, [laterHealthyFailoverIP])
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, [targetIP], false)
    higherOrderTest.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    await higherOrderTest.waitForCoolDownAndVerifyServiceUnHealthy(webService)
  })
  test('Case: Service transition from "unhealthy" to "healthy". Detected unHealthy,active "ip" but failover available at a later point (after failover cooldown and "failed" notification)', async () => {
    //transition to unhealthy
    const targetIP = '10.5.0.21'
    const webService = appState.webServices[serviceKey]!
    const remainingIPs = webService.serviceConf?.addresses?.filter((eachIP) => eachIP !== targetIP)
    expect(remainingIPs?.length).toBeGreaterThan(0)
    const laterHealthyFailoverIP = remainingIPs[0]!
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([targetIP, laterHealthyFailoverIP]))
    await commonTest.advanceBothRealAndFakeTime(1000)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: targetIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderTest.waitForPollToFall(webService, targetIP)
    await higherOrderTest.waitForFailOverInit(webService, [targetIP])
    await higherOrderTest.FAIL_waitForAddressChangeInit(webService, [laterHealthyFailoverIP])
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, [targetIP], false)
    higherOrderTest.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    await higherOrderTest.waitForCoolDownAndVerifyServiceUnHealthy(webService)

    // transition to healthy
    webAppTest.getMswServer().use(...webAppTest.passingResponses([laterHealthyFailoverIP]))
    jest.clearAllMocks()
    // wait for poll reset
    await higherOrderTest.waitForHealthReset(webService, laterHealthyFailoverIP)
    await higherOrderTest.waitForPollToRise(webService, laterHealthyFailoverIP)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: laterHealthyFailoverIP,
      failing: 0,
      passing: 3,
    })
    console.log('jest.clearAllMocks:after:2', (webService.pollSuccess as any)?.mock?.calls)
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, [laterHealthyFailoverIP])
    higherOrderTest.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.DNS_UPDATED)
    await higherOrderTest.waitForCoolDownAndVerifyServiceHealthy(webService)
  })
})

// Have custom beforeEach initializer for each test
describe('Tests Custom. With multi=false', () => {
  const serviceKey = 'crm.ops'
  const zoneRecord = 'crm.ops'
  test('Case: Existing-DnsEntry. Prefer existing dns-server entries. On bootstrap, existing dns record set as "active" address of webService', async () => {
    const targetIP = '10.5.0.22'
    await webAppTest.beforeTestAppInitializer({existingDnsRecords: [{zoneRecord: zoneRecord, ipAddresses: [targetIP]}]})
    const webService = appState.webServices[serviceKey]!
    const targetActiveAddresses = [targetIP]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Case: Existing-DnsEntry but is an unKnown "ip". On bootstrap, first ip from services.yaml, set as activeAddress and synced(unKnown removed) to dns-provider', async () => {
    const unknownIP = '10.5.0.222'
    await webAppTest.beforeTestAppInitializer({
      existingDnsRecords: [{zoneRecord: zoneRecord, ipAddresses: [unknownIP]}],
    })
    const webService = appState.webServices[serviceKey]!
    const firstIP = webService.serviceConf?.addresses?.[0]
    const targetActiveAddresses = [firstIP!]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
})

describe('Tests. With multi=true', () => {
  const serviceKey = 'ecommerce.ops'

  // common before each test initializer for all tests in this group
  beforeEach(async () => {
    await webAppTest.beforeTestAppInitializer()
  })

  test('Case: No-DnsEntries. On Bootstrap, all ips from services.yaml, set as activeAddresses and updated to dns-provider', async () => {
    const webService = appState.webServices[serviceKey]!
    const targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Detect unHealthy, active "ip" and remove from activeAddresses and also the zone records', async () => {
    const webService = appState.webServices[serviceKey]!
    const unHealthyIP = webService.serviceConf?.addresses?.[0]!
    let targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses([unHealthyIP]))
    await commonTest.advanceBothRealAndFakeTime(1000)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: unHealthyIP,
      failing: 3,
      passing: 0,
    })
    await higherOrderTest.waitForPollToFall(webService, unHealthyIP)
    await higherOrderTest.verifyAddressProcessed(webService, unHealthyIP)
    targetActiveAddresses = [...webService.serviceConf?.addresses?.filter((eachAddress) => eachAddress !== unHealthyIP)]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Remain healthy as long as atleast one active ip remains', async () => {
    const webService = appState.webServices[serviceKey]!
    const unHealthyIPs = webService.serviceConf?.addresses?.slice(1)
    let targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses(unHealthyIPs))
    await commonTest.advanceBothRealAndFakeTime(1000)
    for (const unHealthyIP of unHealthyIPs) {
      socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
        ipAddress: unHealthyIP,
        failing: 3,
        passing: 0,
      })
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderTest.waitForPollToFall(webService, unHealthyIP)
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderTest.verifyAddressProcessed(webService, unHealthyIP)
    }
    targetActiveAddresses = [
      ...webService.serviceConf?.addresses?.filter((eachAddress) => !unHealthyIPs.includes(eachAddress)),
    ]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    expect(webService.isFailOverInProgress()).toBe(false)
    expect(webService.serviceState.status).toBe(WebServiceHelper.WEB_SERVICE_STATUS.HEALTHY)
  })
  test('Detect healthy, non-active "ip" and add to activeAddresses and also to zone records', async () => {
    const webService = appState.webServices[serviceKey]!
    const unHealthyIP1 = webService.serviceConf?.addresses?.[0]!
    const unHealthyIP2 = webService.serviceConf?.addresses?.[1]!
    let unHealthyIPs = [unHealthyIP1, unHealthyIP2]
    let targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses(unHealthyIPs))
    await commonTest.advanceBothRealAndFakeTime(1000)
    for (const unHealthyIP of unHealthyIPs) {
      socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
        ipAddress: unHealthyIP,
        failing: 3,
        passing: 0,
      })
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderTest.waitForPollToFall(webService, unHealthyIP)
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderTest.verifyAddressProcessed(webService, unHealthyIP)
    }
    targetActiveAddresses = [
      ...webService.serviceConf?.addresses?.filter((eachAddress) => !unHealthyIPs.includes(eachAddress)),
    ]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    //detect healthy ip back
    webAppTest.getMswServer().use(...webAppTest.passingResponses([unHealthyIP2]))
    unHealthyIPs = unHealthyIPs.filter((eachAddress) => eachAddress !== unHealthyIP2)
    // wait for poll reset
    await higherOrderTest.waitForHealthReset(webService, unHealthyIP2)
    jest.clearAllMocks()
    await higherOrderTest.waitForPollToRise(webService, unHealthyIP2)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: unHealthyIP2,
      failing: 0,
      passing: 3,
    })
    targetActiveAddresses = [
      ...webService.serviceConf?.addresses?.filter((eachAddress) => !unHealthyIPs.includes(eachAddress)),
    ]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Case: Service transition from "healthy" to "unhealthy". All active ips become unhealthy. Service marked "unhealthy" but the last one "ip" retained in zone records', async () => {
    const webService = appState.webServices[serviceKey]!
    const unHealthyIPs = webService.serviceConf?.addresses?.slice(0)
    let targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    jest.clearAllMocks()
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses(unHealthyIPs))
    await commonTest.advanceBothRealAndFakeTime(1000)
    for (const unHealthyIP of unHealthyIPs) {
      socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
        ipAddress: unHealthyIP,
        failing: 3,
        passing: 0,
      })
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderTest.waitForPollToFall(webService, unHealthyIP)
    }
    await higherOrderTest.waitForFailOverInit(webService, unHealthyIPs)
    higherOrderTest.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    await higherOrderTest.waitForCoolDownAndVerifyServiceUnHealthy(webService)
    // one ip retained, even though service unHealthy
    await higherOrderTest.verifyActiveAndResolvedAddressCount(webService, 1, false)
  })
  test('Case: Service transition from "unhealthy" to "healthy". Healthy "ips" become available one by one and everything gets added to activeAddress list and also to zone records', async () => {
    const webService = appState.webServices[serviceKey]!
    const unHealthyIPs = webService.serviceConf?.addresses?.slice(0)
    let targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
    jest.clearAllMocks()
    webAppTest.getMswServer().use(...webAppTest.failByNetworkErrorResponses(unHealthyIPs))
    await commonTest.advanceBothRealAndFakeTime(1000)
    for (const unHealthyIP of unHealthyIPs) {
      socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
        ipAddress: unHealthyIP,
        failing: 3,
        passing: 0,
      })
    }
    for (const unHealthyIP of unHealthyIPs) {
      await higherOrderTest.waitForPollToFall(webService, unHealthyIP)
    }
    await higherOrderTest.waitForFailOverInit(webService, unHealthyIPs)
    higherOrderTest.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    commonTest.advanceBothRealAndFakeTime(5000)
    // one ip retained, even though service unHealthy
    await higherOrderTest.verifyActiveAndResolvedAddressCount(webService, 1, false)
    // healthy ip becomes available
    higherOrderTest.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.HEALTHY_TARGET_NOT_AVAILABLE)
    await higherOrderTest.waitForCoolDownAndVerifyServiceUnHealthy(webService)
    // transition to healthy
    const laterHealthyFailoverIP = unHealthyIPs[0]!
    webAppTest.getMswServer().use(...webAppTest.passingResponses([laterHealthyFailoverIP]))
    jest.clearAllMocks()
    // wait for poll reset
    await higherOrderTest.waitForHealthReset(webService, laterHealthyFailoverIP)
    await higherOrderTest.waitForPollToRise(webService, laterHealthyFailoverIP)
    socketMockTest.receive.healthCheckUpdateBroadcastFromAllPeers(webService, {
      ipAddress: laterHealthyFailoverIP,
      failing: 0,
      passing: 3,
    })
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, [laterHealthyFailoverIP])
    higherOrderTest.verifyFailOverStatus(webService, WebServiceHelper.FAILOVER_PROGRESS.DNS_UPDATED)
    await higherOrderTest.waitForCoolDownAndVerifyServiceHealthy(webService)
  })
})

// Have custom beforeEach initializer for each test
describe('Tests Custom. With multi=true', () => {
  const serviceKey = 'ecommerce.ops'
  const zoneRecord = 'ecommerce.ops'
  test('Case: Existing-Subset-Of-DnsEntries. On Bootstrap, all ips from services.yaml, set as activeAddresses and synced with dns-provider', async () => {
    const targetIP = '10.5.0.32'
    await webAppTest.beforeTestAppInitializer({existingDnsRecords: [{zoneRecord: zoneRecord, ipAddresses: [targetIP]}]})
    const webService = appState.webServices[serviceKey]!
    const targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Case: Existing-UnKnown-DnsEntries. On Bootstrap, all ips from services.yaml, set as activeAddresses and synced (unknowns removed) with dns-provider', async () => {
    const unKnownTargetIP1 = '10.5.0.123'
    const unKnownTargetIP2 = '10.5.0.124'
    await webAppTest.beforeTestAppInitializer({
      existingDnsRecords: [{zoneRecord: zoneRecord, ipAddresses: [unKnownTargetIP1, unKnownTargetIP2]}],
    })
    const webService = appState.webServices[serviceKey]!
    const targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderTest.waitForAddressChangeInit(webService, targetActiveAddresses)
    await commonTest.advanceBothRealAndFakeTime(2000)
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
  test('Case: Existing-Subset-Plus-UnKnown-DnsEntries. On Bootstrap, all ips from services.yaml, set as activeAddresses and synced (add/remove) with dns-provider', async () => {
    const knownTargetIP1 = '10.5.0.31'
    const unKnownTargetIP2 = '10.5.0.124'
    await webAppTest.beforeTestAppInitializer({
      existingDnsRecords: [{zoneRecord: zoneRecord, ipAddresses: [knownTargetIP1, unKnownTargetIP2]}],
    })
    const webService = appState.webServices[serviceKey]!
    const targetActiveAddresses = [...webService.serviceConf?.addresses]
    await higherOrderTest.verifyActiveAndResolvedAddresses(webService, targetActiveAddresses)
  })
})
