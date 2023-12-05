/**
 * Socket client code that manages connection and communication with other captain servers
 */
import io from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { EVENT_NAMES, SOCKET_CLIENT_LOG_ID } from './captainSocketHelper.js';
import { getLeaderUrl, isLeader, setLeaderUrl, webServices } from '../appState.js';
import { broadcastNewLeader } from './captainSocketServerManager.js';
import appConfig from '../appConfig.js';
import { checkCombinedPeerStateAndInitiateAddActiveIP, checkCombinedPeerStateAndInitiateRemoveActiveIP } from '../web-service/webServiceHelper.js';

export const captainUrlVsSocket: {
  [key: string]: Socket;
} = {}

/**
 * Some extra listeners to log debugging messages about communication
 *
 * @param {Socket} socket
 */
async function registerExtraDebugListeners(captainUrl: string, socket: Socket) {
  socket.on("connect", () => {
    console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): connect`);
  });
  socket.io.on("reconnect_attempt", () => {
    console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): reconnect_attempt`);
  });
  socket.io.on("reconnect", () => {
    console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): reconnect`);
  });
  socket.on("disconnect", (reason) => {
    console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): disconnect`);
    if (reason === "io server disconnect") {
      console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): the disconnection was initiated by the server, you need to reconnect manually`)
      socket.connect();
    }
    // else the socket will automatically try to reconnect
  });
  socket.onAnyOutgoing((event, args) => {
    console.debug(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): onAnyOutgoing`, event, JSON.stringify(args))
  });
  socket.onAny((event, args) => {
    console.debug(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): onAny`, event, JSON.stringify(args))
  });  
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
  const socket = io(captainUrl, {});
  captainUrlVsSocket[captainUrl] = socket

  async function newLeader(payLoad: any, otherArgs: any[]) {
    // console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): newLeader`, JSON.stringify(payLoad));
    setLeaderUrl(payLoad.new)
  }

  async function activeAddresses(payLoad: any, otherArgs: any[]) {
    // console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): activeAddresses`, JSON.stringify(payLoad));
    const webServiceManager = webServices[payLoad.serviceKey]!
    if (webServiceManager) {
      webServiceManager.serviceState.active = payLoad.active
    }
  }

  async function completeActiveAddresses(payLoad: any, otherArgs: any[]) {
    console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): completeActiveAddresses`, JSON.stringify(payLoad));
    for (const webServiceKey of Object.keys(payLoad)) {
      const webService = webServices[webServiceKey]
      const activePayLoad = payLoad[webServiceKey]
      if (webService) {
        webService.serviceState.active = activePayLoad
      }
    }
  }


  async function healthCheckRequest(payLoad: any, otherArgs: any[]) {
    console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): healthCheckRequest`, JSON.stringify(payLoad));
  }

  async function healthCheckUpdate(payLoad: any, otherArgs: any[]) {
    // console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): healthCheckUpdate`, JSON.stringify(payLoad));
    const webServiceManager = webServices[payLoad.serviceKey]!
    if (webServiceManager) {
      const checks = webServiceManager.serviceState.checks!
      // console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): healthCheckUpdate:before`, checks);
      checks[payLoad.member] = {
        ...(checks[payLoad.member] || {}),
        [payLoad.address]: {
          failing: payLoad.failing,
          passing: payLoad.passing,
          last_update: payLoad.last_update
        }
      }  
      // If 'leader', recheck potential 'failover' and 'addBack Active Address' agreement,
      // by checking 'state' of all peers
      // since we have received new 'checks' state data
      if (isLeader()) {
        if(payLoad.passing === webServiceManager.rise) {
          checkCombinedPeerStateAndInitiateAddActiveIP(webServiceManager, payLoad.address)
        } else if (payLoad.failing === webServiceManager.fall) {
          checkCombinedPeerStateAndInitiateRemoveActiveIP(webServiceManager, payLoad.address)
        } 
      }
    }
    // console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): healthCheckUpdate:after`, checks);
  }

  async function completeHealthCheckUpdate(payLoad: any, otherArgs: any[]) {
    console.log(`${SOCKET_CLIENT_LOG_ID}(${captainUrl}): completeHealthCheckUpdate`, JSON.stringify(payLoad));
    for (const webServiceKey of Object.keys(payLoad)) {
      const webService = webServices[webServiceKey]
      const checksPayload = payLoad[webServiceKey]
      if (webService) {
        const checks = webService.serviceState.checks!
        for (const eachCaptainUrl of Object.keys(checksPayload)) {
          const eachCaptainChecks = checksPayload[eachCaptainUrl]
          // Update every data from leader except own data
          if (eachCaptainUrl !== appConfig.SELF_URL) {
            checks[eachCaptainUrl] = {
              ...(checks[eachCaptainUrl] || {}), // preserve 'extra' data / merge
              ...eachCaptainChecks
            }
          }
        }
      }
    }
  }
  registerExtraDebugListeners(captainUrl, socket)
  socket.on(EVENT_NAMES.NEW_LEADER, newLeader);
  socket.on(EVENT_NAMES.ACTIVE_ADDRESSES, activeAddresses);
  socket.on(EVENT_NAMES.COMPLETE_ACTIVE_ADDRESSES, completeActiveAddresses);
  socket.on(EVENT_NAMES.HEALTH_CHECK_REQUEST, healthCheckRequest);
  socket.on(EVENT_NAMES.HEALTH_CHECK_UPDATE, healthCheckUpdate);
  socket.on(EVENT_NAMES.COMPLETE_HEALTH_CHECK_UPDATE, completeHealthCheckUpdate)
}

export async function connectWithOtherCaptains(otherCaptains: string[]) {
  console.log(`${SOCKET_CLIENT_LOG_ID}: connectWithOtherCaptains`, otherCaptains)
  await Promise.all(otherCaptains.map((eachCaptainUrl) => connectAndRegisterListenerWithOtherCaptain(eachCaptainUrl).catch((e: any) => {
    console.error(`${SOCKET_CLIENT_LOG_ID}: error with connectWithOtherCaptain`, eachCaptainUrl, e)
    throw e
  })))
}

