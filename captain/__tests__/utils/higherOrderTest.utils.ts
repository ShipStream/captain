import {ERROR_DNS_ZONE_NOT_INITIALIZED_PREFIX} from './../../src/dns/technitiumDnsManager.js'
import appConfig from '../../src/appConfig.js'
import appState from '../../src/appState.js'
import {dnsManager} from '../../src/dns/dnsManager.js'
import {WebServiceManager} from '../../src/web-service/webServiceManager.js'
import * as WebServiceHelper from '../../src/web-service/webServiceHelper.js'
import commonTest, {MATCH_ANY_VALUE} from './commonTest.utils.js'
import webAppTest from './appTest.utils.js'
import {MockSocketClientManager} from './socketMockTest.utils.js'


/**
 * Wait for given count of polls for the given ip
 * Wait time calculated using the services's polling interval and timeouts
 * @param {WebServiceManager} webService
 * @param {string} targetIP
 * @param {number} pollingCount
 */
async function waitForPollCount(
  webService: WebServiceManager,
  targetIP: string,
  pollingCount: number,
  verifyState: boolean = true
) {
  // calculate required timeout based pollingInterval, readTimeout, connectTimeout and 'pollingCount'
  const timeOutInMs =
    (webAppTest.getPollingInterval(webService) * pollingCount +
      (webService.readTimeout + webService.connectTimeout) +
      5) *
    1000
  await expect(
    commonTest.waitUntilCalled(webService, 'pollEachAddress', [MATCH_ANY_VALUE, targetIP], pollingCount, timeOutInMs)
  ).resolves.not.toThrow()
}

/**
 * Verify that the given count of polls for the given ip didn't happen
 * Wait time calculated using the services's polling interval and timeouts
 * @param {WebServiceManager} webService
 * @param {string} targetIP
 * @param {number} pollingCount
 */
async function FAIL_waitForPollCount(
  webService: WebServiceManager,
  targetIP: string,
  pollingCount: number,
) {
  // calculate required timeout based pollingInterval, readTimeout, connectTimeout and 'pollingCount'
  const timeOutInMs =
    (webAppTest.getPollingInterval(webService) * pollingCount +
      (webService.readTimeout + webService.connectTimeout) +
      5) *
    1000
  await expect(
    commonTest.waitUntilCalled(webService, 'pollSuccess', [MATCH_ANY_VALUE, targetIP], pollingCount, timeOutInMs)
  ).rejects.toThrow()
}

/**
 * Wait for given count of poll success for the given ip
 * Wait time calculated using the services's polling interval and timeouts
 * @param {WebServiceManager} webService
 * @param {string} targetIP
 * @param {number} pollingCount
 */
async function waitForPollSuccessCount(
  webService: WebServiceManager,
  targetIP: string,
  pollingCount: number,
  verifyState: boolean = true
) {
  // calculate required timeout based pollingInterval, readTimeout, connectTimeout and 'pollingCount'
  const timeOutInMs =
    (webAppTest.getPollingInterval(webService) * pollingCount +
      (webService.readTimeout + webService.connectTimeout) +
      5) *
    1000
  await expect(
    commonTest.waitUntilCalled(webService, 'pollSuccess', [MATCH_ANY_VALUE, targetIP], pollingCount, timeOutInMs)
  ).resolves.not.toThrow()
  if (verifyState) {
    await commonTest.advanceBothRealAndFakeTime(1000)
    const checksStateOfTargetIP = webAppTest.getChecksDataByCaptainAndIP(webService, appConfig.SELF_URL, targetIP)
    commonTest.attentionLog('waitForPollSuccessCount', checksStateOfTargetIP)
    // expect(checksStateOfTargetIP?.passing).toBeGreaterThanOrEqual(count)
    expect(checksStateOfTargetIP?.passing).toBe(pollingCount)
  }
}

/**
 * Verify that the given count of poll success for the given ip didn't happen
 * Wait time calculated using the services's polling interval and timeouts
 * @param {WebServiceManager} webService
 * @param {string} targetIP
 * @param {number} pollingCount
 */
async function FAIL_waitForPollSuccessCount(
  webService: WebServiceManager,
  targetIP: string,
  pollingCount: number,
) {
  // calculate required timeout based pollingInterval, readTimeout, connectTimeout and 'pollingCount'
  const timeOutInMs =
    (webAppTest.getPollingInterval(webService) * pollingCount +
      (webService.readTimeout + webService.connectTimeout) +
      5) *
    1000
  await expect(
    commonTest.waitUntilCalled(webService, 'pollSuccess', [MATCH_ANY_VALUE, targetIP], pollingCount, timeOutInMs)
  ).rejects.toThrow()
}

/**
 * Wait for given count of poll failure for the given ip
 * Wait time calculated using the services's polling interval and timeouts
 * @param {WebServiceManager} webService
 * @param {string} targetIP
 * @param {number} pollingCount
 */
async function waitForPollFailureCount(
  webService: WebServiceManager,
  targetIP: string,
  pollingCount: number,
  verifyState: boolean = true
) {
  // calculate required timeout based pollingInterval, readTimeout, connectTimeout and 'pollingCount'
  const timeOutInMs =
    (webAppTest.getPollingInterval(webService) * pollingCount +
      (webService.readTimeout + webService.connectTimeout) +
      5) *
    1000
  await expect(
    commonTest.waitUntilCalled(webService, 'pollFailed', [MATCH_ANY_VALUE, targetIP], pollingCount, timeOutInMs)
  ).resolves.not.toThrow()
  if (verifyState) {
    await commonTest.advanceBothRealAndFakeTime(1000)
    const checksStateOfTargetIP = webAppTest.getChecksDataByCaptainAndIP(webService, appConfig.SELF_URL, targetIP)
    // expect(checksStateOfTargetIP?.failing).toBeGreaterThanOrEqual(count)
    expect(checksStateOfTargetIP?.failing).toBe(pollingCount)
  }
}

/**
 * Verify that the given count of poll failure for the given ip didn't happen
 * Wait time calculated using the services's polling interval and timeouts
 * @param {WebServiceManager} webService
 * @param {string} targetIP
 * @param {number} pollingCount
 */
async function FAIL_waitForPollFailureCount(
  webService: WebServiceManager,
  targetIP: string,
  pollingCount: number,
) {
  // calculate required timeout based pollingInterval, readTimeout, connectTimeout and 'pollingCount'
  const timeOutInMs =
    (webAppTest.getPollingInterval(webService) * pollingCount +
      (webService.readTimeout + webService.connectTimeout) +
      5) *
    1000
  await expect(
    commonTest.waitUntilCalled(webService, 'pollFailed', [MATCH_ANY_VALUE, targetIP], pollingCount, timeOutInMs)
  ).rejects.toThrow()
}

/**
 * Wait for 'rise' count of poll failure for the given ip
 * Wait time calculated using the services's polling interval and timeouts and 'rise' value
 *
 * @param {WebServiceManager} webService
 * @param {string} targetIP
 */
async function waitForPollToRise(webService: WebServiceManager, targetIP: string) {
  await waitForPollSuccessCount(webService, targetIP, webService.rise)
}

/**
 * Wait for 'fall' count of poll failure for the given ip
 * Wait time calculated using the services's polling interval and timeouts and 'fall' value
 *
 * @param {WebServiceManager} webService
 * @param {string} targetIP
 */
async function waitForPollToFall(webService: WebServiceManager, targetIP: string) {
  await waitForPollFailureCount(webService, targetIP, webService.fall)
}

/**
 * Call to update dns zone record initiated.
 *
 * @param {WebServiceManager} webService
 * @param {string[]} targetActiveAddresses
 * @param {number} [times=1]
 */
async function waitForAddressChangeInit(
  webService: WebServiceManager,
  targetActiveAddresses: string[],
  times: number = 1
) {
  await expect(
    commonTest.waitUntilCalled(webService, 'handleActiveAddressChange', [targetActiveAddresses], times, 10000)
  ).resolves.not.toThrow()
}

/**
 * Ensure failure to make the call to update dns zone record.
 *
 * @param {WebServiceManager} webService
 * @param {string[]} targetActiveAddresses
 * @param {number} [times=1]
 */
async function FAIL_waitForAddressChangeInit(
  webService: WebServiceManager,
  targetActiveAddresses: string[],
  times: number = 1
) {
  await expect(
    commonTest.waitUntilCalled(webService, 'handleActiveAddressChange', [targetActiveAddresses], times, 10000)
  ).rejects.toThrow()
}

/**
 * Verify that the call to process ipaddress for any state change (eg: health/unhealthy ),
 * has been invoked.
 * It is done only when the poll count reaches 'fall' or 'rise'
 *
 * @param {WebServiceManager} webService
 * @param {string} ipAddress
 */
async function verifyAddressProcessed(webService: WebServiceManager, ipAddress: string) {
  await expect(
    Promise.any([
      commonTest.waitUntilCalled(
        WebServiceHelper.default,
        'checkCombinedPeerStateAndInitiateAddActiveIP',
        [webService, ipAddress],
        1,
        1000
      ),
      commonTest.waitUntilCalled(
        WebServiceHelper.default,
        'checkCombinedPeerStateAndInitiateRemoveActiveIP',
        [webService, ipAddress],
        1,
        1000
      ),
    ])
  ).resolves.not.toThrow()
}

/**
 * Verify that the call to process ipaddress for any state change (eg: health/unhealthy ),
 * has NOT been invoked.
 * Generally the case where poll count didn't reach 'fall' or 'rise'
 */
async function FAIL_verifyAddressProcessed(webService: WebServiceManager, ipAddress: string) {
  await expect(
    commonTest.waitUntilCalled(
      WebServiceHelper.default,
      'checkCombinedPeerStateAndInitiateAddActiveIP',
      [webService, ipAddress],
      1,
      1000
    )
  ).rejects.toThrow()
  await expect(
    commonTest.waitUntilCalled(
      WebServiceHelper.default,
      'checkCombinedPeerStateAndInitiateRemoveActiveIP',
      [webService, ipAddress],
      1,
      1000
    )
  ).rejects.toThrow()
}

/**
 * Verify that the no of 'dns-records' of a service matches the given input
 */
async function verifyActiveAndResolvedAddressCount(
  webService: WebServiceManager,
  noOfAddresses: number,
  shouldWaitForAddressChangeInit = true
) {
  if (shouldWaitForAddressChangeInit) {
    await waitForAddressChangeInit(webService, [MATCH_ANY_VALUE as any])
  }
  expect(webService.serviceState.active.length).toBe(noOfAddresses)
  await commonTest.advanceBothRealAndFakeTime(5000)
  const resolvedAddresses = await dnsManager.resolvedAddresses(webService.serviceConf.zone_record)
  console.log({resolvedAddresses, activeAddresses: webService.serviceState.active})
  expect(resolvedAddresses.length).toBe(noOfAddresses)
}

/**
 * Verify that the 'zone' records match the given 'ips'
 * Also ensure the 'active' (addresses) of the service match the given 'ips'
 */
async function verifyActiveAndResolvedAddresses(
  webService: WebServiceManager,
  targetActiveAddresses: string[],
  shouldWaitForAddressChangeInit = true
) {
  if (shouldWaitForAddressChangeInit) {
    await waitForAddressChangeInit(webService, targetActiveAddresses)
  }
  expect(new Set(targetActiveAddresses)).toEqual(new Set(webService.serviceState.active))
  await commonTest.advanceBothRealAndFakeTime(1000)
  let resolvedAddresses = await dnsManager.resolvedAddresses(webService.serviceConf.zone_record)
  console.log({targetActiveAddresses, resolvedAddresses, activeAddresses: webService.serviceState.active})
  expect(new Set(targetActiveAddresses)).toEqual(new Set(resolvedAddresses))
}

/**
 * Verify that the given ip is present neither in 'zone' records nor in 'active' (addresses) of the service
 *
 * @param {WebServiceManager} webService
 * @param {string} targetAddress
 */
async function FAIL_verifyActiveAndResolvedContain(webService: WebServiceManager, targetAddress: string) {
  await expect(
    commonTest.waitUntilCalled(webService, 'handleActiveAddressChange', [targetAddress], 1, 10000)
  ).rejects.toThrow()
  expect(webService.serviceState.active).not.toContain(targetAddress)
  await commonTest.advanceBothRealAndFakeTime(1000)
  const resolvedAddresses = await dnsManager.resolvedAddresses(webService.serviceConf.zone_record).catch((e) => {
    // dns server may not be initialized in case of non-leader
    if (`${e?.errorMessage}`.startsWith(ERROR_DNS_ZONE_NOT_INITIALIZED_PREFIX)) {
      return []
    }
    throw e
  })
  console.log({targetAddress, resolvedAddresses, activeAddresses: webService.serviceState.active})
  expect(resolvedAddresses || []).not.toContain(targetAddress)
}

/**
 * Ensure that the failover is in progress with given status
 */
function verifyFailOverStatus(webService: WebServiceManager, failOverStatus: string) {
  expect(webService.isFailOverInProgress()).toBe(true)
  expect(webService.serviceState.failover_progress).toBe(failOverStatus)
}

/**
 * Wait and ensure that both 'failing' and 'passing' are 'zero' for the given ip
 */
async function waitForHealthReset(webService: WebServiceManager, ipAddress: string) {
  await expect(
    commonTest.waitUntilPredicateSucceeds(() => {
      const checksStateOfTargetIP = webAppTest.getChecksDataByCaptainAndIP(webService, appConfig.SELF_URL, ipAddress)
      // check for reset to 'failing=0 and passing=0'
      return checksStateOfTargetIP?.failing === 0 && checksStateOfTargetIP?.passing === 0
    })
  ).resolves.not.toThrow()
}

/**
 * Calculate wait time using 'cooldown' parameter of the service and ensure,
 * that the 'failover' is finished and the service is 'healthy'
 *
 * @param {WebServiceManager} webService
 */
async function waitForCoolDownAndVerifyServiceHealthy(webService: WebServiceManager) {
  await expect(
    commonTest.waitUntilPredicateSucceeds(() => {
      return (
        !webService.isFailOverInProgress() &&
        webService.serviceState.status === WebServiceHelper.WEB_SERVICE_STATUS.HEALTHY
      )
    }, webService.coolDown * 1000)
  ).resolves.not.toThrow()
}

/**
 * Calculate wait time using 'cooldown' parameter of the service and ensure,
 * that the 'failover' is finished and the service is 'unHealthy'
 *
 * @param {WebServiceManager} webService
 */
async function waitForCoolDownAndVerifyServiceUnHealthy(webService: WebServiceManager) {
  await expect(
    commonTest.waitUntilPredicateSucceeds(() => {
      return (
        !webService.isFailOverInProgress() &&
        webService.serviceState.status === WebServiceHelper.WEB_SERVICE_STATUS.UN_HEALTHY
      )
    }, webService.coolDown * 1000)
  ).resolves.not.toThrow()
}

/**
 * Verify that the given captain received the 'NEW_LEADER' notification
 *
 * @param {MockSocketClientManager} mockClientSocketManager
 */
async function verifyRemoteCaptainReceivedNewLeader(mockClientSocketManager: MockSocketClientManager) {
  await expect(
    commonTest.waitUntilCalled(
      mockClientSocketManager.clientSocket, // socket is used as 'this' using 'apply' by socket.io lib
      mockClientSocketManager.newLeader,
      [MATCH_ANY_VALUE],
      1,
      1
    )
  ).resolves.not.toThrow()
}

/**
 * Verify that the given captain received the 'HEALTH_CHECK_UPDATE' notification
 * Uses an optional 'matchData' to ensure the 'payload' that matches the given criteria has been sent
 * @param {MockSocketClientManager} mockClientSocketManager
 * @param {{
 *     ipAddress?: string
 *     passing?: number
 *     failing?: number
 *   }} [matchData]
 */
async function verifyRemoteCaptainReceivedHealthCheckUpdate(
  mockClientSocketManager: MockSocketClientManager,
  matchData?: {
    ipAddress?: string
    passing?: number
    failing?: number
  }
) {
  await expect(
    commonTest.waitUntilCalled(
      mockClientSocketManager.clientSocket, // socket is used as 'this' using 'apply' by socket.io lib
      mockClientSocketManager.healthCheckUpdate,
      (argsList: any[]) => {
        const payLoad = argsList?.[0]
        // all matches are optional, so 'undefined' means 'match'
        const passingMatch = matchData?.passing === undefined || payLoad?.passing === matchData?.passing
        const failingMatch = matchData?.failing === undefined || payLoad?.failing === matchData?.failing
        const ipMatch = matchData?.ipAddress === undefined || payLoad?.address === matchData?.ipAddress
        return passingMatch && failingMatch && ipMatch
      },
      1,
      1
    )
  ).resolves.not.toThrow()
}

/**
 * Ensure the FAILURE to receive the 'HEALTH_CHECK_UPDATE' notification
 * Uses an optional 'matchData' to identify the notification by matching with payload
 * @param {MockSocketClientManager} mockClientSocketManager
 * @param {{
 *     ipAddress?: string
 *     passing?: number
 *     failing?: number
 *   }} [matchData]
 */
async function FAIL_verifyRemoteCaptainReceivedHealthCheckUpdate(
  mockClientSocketManager: MockSocketClientManager,
  matchData?: {
    ipAddress?: string
    passing?: number
    failing?: number
  }
) {
  await expect(
    commonTest.waitUntilCalled(
      mockClientSocketManager.clientSocket, // socket is used as 'this' using 'apply' by socket.io lib
      mockClientSocketManager.healthCheckUpdate,
      (argsList: any[]) => {
        const payLoad = argsList?.[0]
        // all matches are optional, so 'undefined' means 'match'
        const passingMatch = matchData?.passing === undefined || payLoad?.passing === matchData?.passing
        const failingMatch = matchData?.failing === undefined || payLoad?.failing === matchData?.failing
        const ipMatch = matchData?.ipAddress === undefined || payLoad?.address === matchData?.ipAddress
        return passingMatch && failingMatch && ipMatch
      },
      1,
      1
    )
  ).rejects.toThrow()
}

/**
 * Verify that the given captain received the 'BULK_HEALTH_CHECK_UPDATE' notification
 */
async function verifyRemoteCaptainReceivedBulkHealthCheckUpdate(mockClientSocketManager: MockSocketClientManager) {
  await expect(
    commonTest.waitUntilCalled(
      mockClientSocketManager.clientSocket, // socket is used as 'this' using 'apply' by socket.io lib
      mockClientSocketManager.bulkHealthCheckUpdate,
      [MATCH_ANY_VALUE],
      1,
      1
    )
  ).resolves.not.toThrow()
}

/**
 * Verify that the given captain didn't received the 'NEW_REMOTE_SERVICES' notification in the given time
 */
async function FAIL_verifyRemoteCaptainReceivedNewRemoteServices(mockClientSocketManager: MockSocketClientManager, times: number = 1) {
  await expect(
    commonTest.waitUntilCalled(
      mockClientSocketManager.clientSocket, // socket is used as 'this' using 'apply' by socket.io lib
      mockClientSocketManager.newRemoteServices,
      [MATCH_ANY_VALUE],
      times,
      1
    )
  ).rejects.toThrow()
}


/**
 * Verify that the given captain received the 'NEW_REMOTE_SERVICES' notification
 */
async function verifyRemoteCaptainReceivedNewRemoteServices(mockClientSocketManager: MockSocketClientManager, times: number = 1) {
  await expect(
    commonTest.waitUntilCalled(
      mockClientSocketManager.clientSocket, // socket is used as 'this' using 'apply' by socket.io lib
      mockClientSocketManager.newRemoteServices,
      [MATCH_ANY_VALUE],
      times,
      1
    )
  ).resolves.not.toThrow()
}

/**
 * Verify that the given captain received the 'MATE_DISCONNECTED' notification
 */
async function verifyRemoteCaptainReceivedMateDisconnected(mockClientSocketManager: MockSocketClientManager) {
  await expect(
    commonTest.waitUntilCalled(
      mockClientSocketManager.clientSocket, // socket is used as 'this' using 'apply' by socket.io lib
      mockClientSocketManager.mateDisconnected,
      [MATCH_ANY_VALUE],
      1,
      1
    )
  ).resolves.not.toThrow()
}


/**
 * Ensure that the give set of unhealthy ips were removed one by one,
 * and when all the 'ips' become unhealthy, initiate 'failover' process
 *
 * @param {WebServiceManager} webService
 * @param {string[]} unHealthyIPs
 */
async function waitForFailOverInit(webService: WebServiceManager, unHealthyIPs: string[]) {
  const allAddresses = [...webService.serviceConf?.addresses]
  const remainingHealthyIps = allAddresses?.filter((eachAddress) => !unHealthyIPs?.includes(eachAddress)) || []
  for (const unHealthyIP of unHealthyIPs) {
    await commonTest.waitUntilCalled(
      WebServiceHelper.default,
      'checkCombinedPeerStateAndInitiateRemoveActiveIP',
      [webService, unHealthyIP],
      1,
      5000
    )
  }
  // no of address change calls to remote ip from dns.
  // one ip retained even if unhealthy if it is the last ip, so check for 'remainingHealthyIps' length
  const noOfAddressChangeCalls = remainingHealthyIps.length > 0 ? unHealthyIPs.length : unHealthyIPs.length - 1
  const targetActiveAddresses = unHealthyIPs.length === 1 ? [unHealthyIPs[0]] : MATCH_ANY_VALUE
  await expect(
    commonTest.waitUntilCalled(
      webService,
      'handleActiveAddressChange',
      [targetActiveAddresses],
      noOfAddressChangeCalls,
      10000
    )
  ).resolves.not.toThrow()
  await expect(
    commonTest.waitUntilCalled(webService, 'beginFailOverProcess', [MATCH_ANY_VALUE], 1, 5000)
  ).resolves.not.toThrow()
}

/**
 * Ensure that the 'failover' process was NOT triggered
 *
 * @param {WebServiceManager} webService
 * @param {string} targetIP
 * @param {number} [times=1]
 */
async function FAIL_waitForFailOverInit(webService: WebServiceManager, targetIP: string, times: number = 1) {
  await commonTest.waitUntilCalled(
    WebServiceHelper.default,
    'checkCombinedPeerStateAndInitiateRemoveActiveIP',
    [webService, targetIP],
    1,
    5000
  )
  await expect(commonTest.waitUntilCalled(webService, 'beginFailOverProcess', [targetIP], 1, 5000)).rejects.toThrow()
}

/**
 * Make sure, service with the given params is not registered
 *
 */
async function FAIL_waitUntilServiceRegistered(serviceKey: string, addresses: string[] = [], timeOutInMs: number = 10000) {
  await expect(
    commonTest.waitUntilPredicateSucceeds(() => {
      const webService = appState.getWebService(serviceKey)
      if (webService !== undefined) {
        if (addresses) {
          for(const eachAddress of addresses) {
            if (!webService.serviceConf.addresses.includes(eachAddress)) {
              return false
            }
          }
        }
        return true
      }
      return false
    }, timeOutInMs)
  ).rejects.toThrow()
}

/**
 * Wait until the given service is registered into the captain
 *
 */
async function waitUntilServiceRegistered(serviceKey: string, addresses: string[] = [], timeOutInMs: number = 10000) {
  await expect(
    commonTest.waitUntilPredicateSucceeds(() => {
      const webService = appState.getWebService(serviceKey)
      if (webService !== undefined) {
        if (addresses) {
          for(const eachAddress of addresses) {
            if (!webService.serviceConf.addresses.includes(eachAddress)) {
              return false
            }
          }
        }
        return true
      }
      return false
    }, timeOutInMs)
  ).resolves.not.toThrow()
}

const higherOrderTest = {
  waitForPollSuccessCount,
  FAIL_waitForPollSuccessCount,
  waitForPollFailureCount,
  FAIL_waitForPollFailureCount,
  waitForPollToRise,
  waitForPollToFall,
  waitForAddressChangeInit,
  FAIL_waitForAddressChangeInit,
  verifyActiveAndResolvedAddresses,
  FAIL_verifyActiveAndResolvedContain,
  verifyActiveAndResolvedAddressCount,
  verifyAddressProcessed,
  FAIL_verifyAddressProcessed,
  verifyFailOverStatus,
  waitForHealthReset,
  waitForCoolDownAndVerifyServiceHealthy,
  waitForCoolDownAndVerifyServiceUnHealthy,
  verifyRemoteCaptainReceivedNewLeader,
  verifyRemoteCaptainReceivedHealthCheckUpdate,
  FAIL_verifyRemoteCaptainReceivedHealthCheckUpdate,
  verifyRemoteCaptainReceivedBulkHealthCheckUpdate,
  waitForFailOverInit,
  FAIL_waitForFailOverInit,
  verifyRemoteCaptainReceivedNewRemoteServices,
  FAIL_verifyRemoteCaptainReceivedNewRemoteServices,  
  verifyRemoteCaptainReceivedMateDisconnected,
  FAIL_waitUntilServiceRegistered,
  waitUntilServiceRegistered,
  FAIL_waitForPollCount,
  waitForPollCount,
}

export default higherOrderTest
