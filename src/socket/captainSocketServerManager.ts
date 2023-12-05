/**
 * Socket server that handles communication from other captains
 */

import type { Socket, Server as SocketServer } from "socket.io";
import { EVENT_NAMES, SOCKET_SERVER_LOG_ID } from "./captainSocketHelper.js";
import { WebServiceManager } from "../web-service/webServiceManager.js";
import appConfig from "../appConfig.js";
import { getLeaderUrl, isLeader, webServices } from "../appState.js";

let io: SocketServer

export function getServerSocketIO() {
  return io
}


/**
 * Setup connection from clients ('peers')
 *
 * @export
 * @param {SocketServer} inputIO
 */
export function setupSocketConnectionAndListeners(inputIO: SocketServer) {
  io = inputIO
  io.on("connection", async (socket) => {
    registerDebugListeners(socket)
    if (isLeader()) {
      transferInitialData(socket)
    }
  });  
}

/**
 * Transfer complete set of data to captain peers. Help nodes that could potentially join later
 *
 * @param {Socket} socket
 */
function transferInitialData(socket: Socket) {
  broadcastNewLeaderToSocket(socket, getLeaderUrl())
  broadcastCompleteHealthCheckUpdateToSocket(socket)
  broadcastCompleteActiveAddressesToSocket(socket)
}

/**
 * Some basic listeners to log debugging messages about communication from this server
 *
 * @param {Socket} socket
 */
async function registerDebugListeners(socket: Socket) {
  console.log(`${SOCKET_SERVER_LOG_ID}: New connection: registerListeners`, {
    'new': [ socket.id, socket.handshake.address ],
    'all': (await io.fetchSockets()).map((eachSocket) => [ eachSocket.id, eachSocket.handshake.address ])
  })
  socket.onAnyOutgoing((event, args) => {
    console.debug(`${SOCKET_SERVER_LOG_ID}: onAnyOutgoing(${socket.handshake.address})`, event, JSON.stringify(args))
  });
  socket.onAny((event, args) => {
    console.debug(`${SOCKET_SERVER_LOG_ID}: onAny(${socket.handshake.address})`, event, JSON.stringify(args))
  });  
}


/**
 * Broadcast individual failing/passing health check per 'web service' per 'ip address'
 *
 * @export
 * @param {WebServiceManager} webService
 * @param {string} ipAddress
 */
export function broadcastHealthCheckUpdate(webService: WebServiceManager, ipAddress: string) {
  io.emit(EVENT_NAMES.HEALTH_CHECK_UPDATE, {
    member: appConfig.SELF_URL,
    serviceKey: webService.serviceKey,
    service: webService.serviceState.service.name,
    address: ipAddress,
    failing: webService.statsForCurrentCaptain[ipAddress]!.failing,
    passing: webService.statsForCurrentCaptain[ipAddress]!.passing,
    last_update: webService.statsForCurrentCaptain[ipAddress]!.last_update,
  })
}


/**
 * Broadcast new leader to 'peers'
 *
 * @export
 * @param {string} leaderURL
 */
export function broadcastNewLeader(leaderURL: string) {
  io.emit(EVENT_NAMES.NEW_LEADER, {
    'new': leaderURL,
  })
}


/**
 * Broadcast 'active' addresses of a web service to 'peers'
 * Called only by 'leader'
 *
 * @export
 * @param {WebServiceManager} webService
 */
export function broadcastActiveAddresses(webService: WebServiceManager) {
  io.emit(EVENT_NAMES.ACTIVE_ADDRESSES, {
    serviceKey: webService.serviceKey,
    service: webService.serviceState.service.name,
    active: webService.serviceState.active,
  })
}

/**
 * Broadcast 'active' addresses of all web service for newly discovered captain
 * Called only by 'leader'
 *
 */
export function broadcastCompleteActiveAddressesToSocket(socket: Socket) {
  const completeActiveAddresses =Object.keys(webServices).reduce((accumlator: any, currentServiceKey: string) => {
    const webService = webServices[currentServiceKey]!
    accumlator[currentServiceKey] = webService.serviceState.active
    return accumlator
  }, {})
  io.emit(EVENT_NAMES.COMPLETE_ACTIVE_ADDRESSES, completeActiveAddresses)
}

/**
 * Send complete checks 'state' for newly discovered captain
 *
 * @export
 * @param {Socket} socket
 */
export function broadcastCompleteHealthCheckUpdateToSocket(socket: Socket) {
  const completeChecks =Object.keys(webServices).reduce((accumlator: any, currentServiceKey: string) => {
    const webService = webServices[currentServiceKey]!
    accumlator[currentServiceKey] = webService.serviceState.checks
    return accumlator
  }, {})
  socket.emit(EVENT_NAMES.COMPLETE_HEALTH_CHECK_UPDATE, completeChecks)
}


/**
 * Send leader data to newly discovered captain
 *
 * @export
 * @param {Socket} socket
 * @param {string} leaderURL
 */
export function broadcastNewLeaderToSocket(socket: Socket, leaderURL: string) {
  socket.emit(EVENT_NAMES.NEW_LEADER, {
    'new': leaderURL,
  })
}
