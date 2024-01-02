/**
 * Socket client code that manages connection and communication with other captain servers
 */
import io from 'socket.io-client'
import type {Socket} from 'socket.io-client'
import jwt from 'jsonwebtoken'
import {EVENT_NAMES, SOCKET_CLIENT_LOG_ID} from './captainSocketHelper.js'
import {isLeader, setLeaderUrl, webServices} from '../appState.js'
import appConfig from '../appConfig.js'
import {
  HEALTH_CHECK_REQUEST_VERIFY_STATE,
  RESET_POLLING_REQUEST_POLLING_TYPE,
  checkCombinedPeerStateAndInitiateAddActiveIP,
  checkCombinedPeerStateAndInitiateRemoveActiveIP,
} from '../web-service/webServiceHelper.js'
import {logger} from './../coreUtils.js'

export const captainUrlVsSocket: {
  [key: string]: Socket
} = {}

/**
 * Some extra listeners to log debugging messages about communication
 *
 * @param {Socket} socket
 */
async function registerExtraDebugListeners(captainUrl: string, socket: Socket) {
  const logID = `${SOCKET_CLIENT_LOG_ID}(To ${captainUrl})`
  socket.on('connect', () => {
    logger.info(`${logID}: connect`)
  })
  socket.io.on('reconnect_attempt', () => {
    logger.info(`${logID}: reconnect_attempt`)
  })
  socket.io.on('reconnect', () => {
    logger.info(`${logID}: reconnect`)
  })
  socket.on('connect_error', (err: Error) => {
    logger.info(`${logID}: connect_error`, err?.message)
  })
  socket.on('disconnect', (reason) => {
    logger.info(`${logID}: disconnect`)
    if (reason === 'io server disconnect') {
      logger.info(`${logID}: the disconnection was initiated by the server, you need to reconnect manually`)
      socket.connect()
    }
    // else the socket will automatically try to reconnect
  })
  socket.onAnyOutgoing((event, args) => {
    logger.debug(`${logID}: onAnyOutgoing`, event, JSON.stringify(args))
  })
  socket.onAny((event, args) => {
    logger.debug(`${logID}: onAny`, event, JSON.stringify(args))
  })
}

function getToken() {
  const currentDate = new Date()
  const expiryDate = new Date()
  expiryDate.setHours(expiryDate.getMinutes() + 2)
  const payLoad = {
    sub: appConfig.SELF_URL,
    iat: currentDate.getTime(),
    type: 'ACCESS_TOKEN',
    exp: expiryDate.getTime(),
  }
  return jwt.sign(payLoad, appConfig.CAPTAIN_SECRET_KEY)
}

/**
 * Register listener for listening to 'gossip' from other captain 'peers'
 * Maintain 'state' using function encapsulation eg: captainUrl
 *
 * @export
 * @param {string} captainUrl
 */
export async function connectAndRegisterListenerWithOtherCaptain(captainUrl: string) {
  // const socket = io(captainUrl, {query: { SELF_URL: appConfig.SELF_URL }});
  const socket = io(captainUrl, {query: {token: getToken()}})
  captainUrlVsSocket[captainUrl] = socket
  const logID = `${SOCKET_CLIENT_LOG_ID}(To ${captainUrl})`
  function newLeader(payLoad: any) {
    try {
      setLeaderUrl(payLoad.new)
    } catch (e) {
      logger.error(
        new Error(`${logID}: newLeader: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  function activeAddresses(payLoad: any) {
    try {
      const webServiceManager = webServices[payLoad.serviceKey]!
      if (webServiceManager) {
        webServiceManager.setActiveAddresses(payLoad.addresses)
      } else {
        logger.warn(`${logID}: activeAddresses: Unknown Service: %{payLoad.serviceKey}`)
      }
    } catch (e) {
      logger.error(
        new Error(`${logID}: activeAddresses: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  function bulkActiveAddresses(payLoadArray: any) {
    try {
      // Array of active address payload
      for (const eachPayLoad of payLoadArray) {
        activeAddresses(eachPayLoad)
      }
    } catch (e) {
      logger.error(
        new Error(`${logID}: bulkActiveAddresses: Details: ${payLoadArray}`, {
          cause: e,
        })
      )
    }
  }

  function healthCheckRequest(payLoad: any) {
    try {
      logger.info('healthCheckRequest', payLoad)
      const webServiceManager = webServices[payLoad.serviceKey]!
      if (webServiceManager) {
        if (payLoad.verifyState === HEALTH_CHECK_REQUEST_VERIFY_STATE.PASSING) {
          webServiceManager.resetHealthCheckByIPToVerifyPassing(payLoad.address)
        } else if (payLoad.verifyState === HEALTH_CHECK_REQUEST_VERIFY_STATE.FAILING) {
          webServiceManager.resetHealthCheckByIPToVerifyFailing(payLoad.address)
        } else {
          webServiceManager.resetHealthCheckByIP(payLoad.address)
        }
      } else {
        logger.warn(`${logID}: healthCheckRequest: Unknown Service: %{payLoad.serviceKey}`)
      }
    } catch (e) {
      logger.error(
        new Error(`${logID}: healthCheckRequest: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  function resetPollingRequest(payLoad: any) {
    try {
      logger.info('resetPollingRequest', payLoad)
      const webServiceManager = webServices[payLoad.serviceKey]!
      if (webServiceManager) {
        if (payLoad.pollingType === RESET_POLLING_REQUEST_POLLING_TYPE.HEALTHY) {
          webServiceManager.markHealthy()
        } else if (payLoad.pollingType === RESET_POLLING_REQUEST_POLLING_TYPE.UN_HEALTHY) {
          webServiceManager.markUnHealthy()
        } else {
          logger.warn(`${logID}: resetPollingRequest: Unknown polling type`)
        }
      } else {
        logger.warn(`${logID}: resetPollingRequest: Unknown Service: %{payLoad.serviceKey}`)
      }
    } catch (e) {
      logger.error(
        new Error(`${logID}: resetPollingRequest: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  function healthCheckUpdate(payLoad: any) {
    try {
      // logger.info(`${logID}: healthCheckUpdate`, payLoad)
      const webServiceManager = webServices[payLoad.serviceKey]!
      if (webServiceManager) {
        // Skip own data from 'other' memebers, usually in case of bulkHealthCheckUpdate
        if (payLoad.member !== appConfig.SELF_URL) {
          const checks = webServiceManager.serviceState.checks!
          const existingData = checks[payLoad.member]?.[payLoad.address]
          const existingLastUpdate = existingData?.last_update
          if (!existingLastUpdate || new Date(existingLastUpdate).getTime() < new Date(payLoad.last_update).getTime()) {
            logger.debug(`${logID}: healthCheckUpdate: new data updated into system`, JSON.stringify(payLoad))
            checks[payLoad.member] = {
              ...(checks[payLoad.member] || {}),
              [payLoad.address]: {
                failing: payLoad.failing,
                passing: payLoad.passing,
                last_update: payLoad.last_update,
              },
            }
          } else {
            logger.info(`${logID}: healthCheckUpdate: already have the latest data. Ignoring`, {
              existingData: JSON.stringify(payLoad),
              incomingData: JSON.stringify(payLoad),
            })
          }
          // If 'leader', recheck potential 'failover' and 'addBack Active Address' agreement,
          // by checking 'state' of all peers
          // since we have received new 'checks' state data
          if (isLeader()) {
            if (payLoad.passing === webServiceManager.rise) {
              checkCombinedPeerStateAndInitiateAddActiveIP(webServiceManager, payLoad.address).catch((e) => {
                logger.error(e)
              })
            } else if (payLoad.failing === webServiceManager.fall) {
              checkCombinedPeerStateAndInitiateRemoveActiveIP(webServiceManager, payLoad.address).catch((e) => {
                logger.error(e)
              })
            }
          }
          // logger.info(`${logID}: healthCheckUpdate:after`, checks);
        }
      } else {
        logger.warn(`${logID}: healthCheckUpdate: Unknown Service: %{payLoad.serviceKey}`)
      }
    } catch (e) {
      logger.error(
        new Error(`${logID}: healthCheckUpdate: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

  function bulkHealthCheckUpdate(payLoadArray: any) {
    try {
      for (const eachPayLoad of payLoadArray) {
        healthCheckUpdate(eachPayLoad)
      }
    } catch (e) {
      logger.error(
        new Error(`${logID}: bulkHealthCheckUpdate: Details: ${payLoadArray}`, {
          cause: e,
        })
      )
    }
  }

  registerExtraDebugListeners(captainUrl, socket)
  socket.on(EVENT_NAMES.NEW_LEADER, newLeader)
  socket.on(EVENT_NAMES.ACTIVE_ADDRESSES, activeAddresses)
  socket.on(EVENT_NAMES.BULK_ACTIVE_ADDRESSES, bulkActiveAddresses)
  socket.on(EVENT_NAMES.HEALTH_CHECK_REQUEST, healthCheckRequest)
  socket.on(EVENT_NAMES.RESET_POLLING_REQUEST, resetPollingRequest)
  socket.on(EVENT_NAMES.HEALTH_CHECK_UPDATE, healthCheckUpdate)
  socket.on(EVENT_NAMES.BULK_HEALTH_CHECK_UPDATE, bulkHealthCheckUpdate)
}

export async function connectWithOtherCaptains(otherCaptains: string[]) {
  try {
    logger.info(`${SOCKET_CLIENT_LOG_ID}: connectWithOtherCaptains`, otherCaptains)
    await Promise.all(
      otherCaptains.map((eachCaptainUrl) =>
        connectAndRegisterListenerWithOtherCaptain(eachCaptainUrl).catch((e: any) => {
          logger.error(
            new Error(
              `${SOCKET_CLIENT_LOG_ID}: error with connectAndRegisterListenerWithOtherCaptain: ${eachCaptainUrl}`,
              {cause: e}
            )
          )
          throw e
        })
      )
    )
  } catch (e) {
    logger.error(
      new Error(`${SOCKET_CLIENT_LOG_ID}: error with connectWithOtherCaptains: ${otherCaptains}`, {
        cause: e,
      })
    )
  }
}
