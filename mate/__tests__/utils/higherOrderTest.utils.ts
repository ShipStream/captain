import appConfig from '../../src/appConfig.js'
import {PASS_FAIL_IP_STATES, WebServiceManager} from '../../src/webServiceManager.js'
import commonTest, {MATCH_ANY_VALUE} from './commonTest.utils.js'
import webAppTest from './appTest.utils.js'
import { MockCaptainSocketServer } from './remoteCaptainMock.utils.js'

/**
 * Verify that the given captain received the 'NEW_REMOTE_SERVICES' notification
 */
async function verifyRemoteCaptainReceivedNewRemoteServices(mockCaptainServer: MockCaptainSocketServer, times: number = 1, timeOutInMs: number =  1) {
  await expect(
    commonTest.waitUntilCalled(
      mockCaptainServer.socket!, // socket is used as 'this' using 'apply' by socket.io lib
      mockCaptainServer.newRemoteServices,
      [MATCH_ANY_VALUE],
      times,
      timeOutInMs
    )
  ).resolves.not.toThrow()
}

/**
 * Verify that the given captain received the 'SERVICE_STATE_CHANGE' notification
 */
async function verifyRemoteCaptainReceivedServiceStateChange(mockCaptainServer: MockCaptainSocketServer, times: number = 1, timeOutInMs: number =  1) {
  await expect(
    commonTest.waitUntilCalled(
      mockCaptainServer.socket!, // socket is used as 'this' using 'apply' by socket.io lib
      mockCaptainServer.serviceStateChange,
      [MATCH_ANY_VALUE],
      times,
      timeOutInMs
    )
  ).resolves.not.toThrow()
}

/**
 * Wait and ensure that all ips of the service reached 'passing' state
 */
async function waitForAllIpsOfTheServiceToBePassing(webService: WebServiceManager) {
  // calculate required timeout based pollingInterval, readTimeout, connectTimeout and 'pollingCount'
  const timeOutInMs =
    (webService.pollingInterval * webService.serviceConf.mate.addresses.length +
      (webService.readTimeout + webService.connectTimeout) +
      5) *
    1000
  // const startTime = Date.now()
  await expect(
    commonTest.waitUntilPredicateSucceeds(() => {
      // logger.info('waitForAllIpsOfTheServiceToBePassing', {
      //   timeOutInMs,
      //   remainingTimeInMs: timeOutInMs - (Date.now() - startTime),
      //   state: webService.serviceState.checks,
      // })
      return Object.keys(webService.serviceState.checks).every((eachIP) => {
        return webService.serviceState.checks[eachIP]?.state === PASS_FAIL_IP_STATES.STATE_UP
      })
    }, timeOutInMs)
  ).resolves.not.toThrow()
}

const higherOrderTest = {
  verifyRemoteCaptainReceivedNewRemoteServices,
  verifyRemoteCaptainReceivedServiceStateChange,
  waitForAllIpsOfTheServiceToBePassing,
}

export default higherOrderTest
