/**
 * Socket server that handles communication from mates
 */

import {type ServerOptions, type Socket as ServerSocket, Server as IOServer} from 'socket.io'
import jwt from 'jsonwebtoken'
import {MATE_EVENT_NAMES, MATE_SOCKET_SERVER_LOG_ID, closeGivenServer} from './captainSocketHelper.js'
import appConfig from '../appConfig.js'
import {logger, processMateDisconnection} from '../coreUtils.js'
import appState from '../appState.js'

export class MateSocketServerManager {
  io!: IOServer

  private async getSocketDetails() {
    return (await this.io.fetchSockets()).map((eachSocket) => [
      eachSocket.id,
      eachSocket.handshake.query?.clientOrigin,
    ])
  }

  /**
   * Some basic listeners to log debugging messages about communication from this server
   *
   * @param {ServerSocket} socket
   */
  private async eachClientDebugListeners(logID:string, socket: ServerSocket) {
    socket.on("disconnecting", (reason) => {
      logger.info(logID, 'disconnecting', reason)
    });
    socket.onAnyOutgoing((event, args) => {
      logger.info(`${logID}: outgoingMessage(${socket.handshake.address})`, event, JSON.stringify(args))
    })
    socket.onAny((event, args) => {
      logger.info(`${logID}: incomingMessage(${socket.handshake.address})`, event, JSON.stringify(args))
    })
  }

  private async eachClientConnectionListeners(socket: ServerSocket) {
    const mateID = `${socket.handshake.query?.clientOrigin}`
    const logID = `${MATE_SOCKET_SERVER_LOG_ID}(Remote Client: ${mateID})`
    logger.info(`${logID}: New connection: registerListeners`, {
      new: [socket.id, mateID],
      all: await this.getSocketDetails(),
    })
    this.eachClientDebugListeners(logID, socket)
    socket.on(MATE_EVENT_NAMES.NEW_REMOTE_SERVICES, (payLoad) => {
      this.receiveNewRemoteServices(logID, payLoad)
    })
    socket.on("disconnect", async (reason) => {
      logger.info(logID, 'disconnect', {
        reasonForDisconnection: reason,
        remainingOpenConnections: await this.getSocketDetails(),        
        mateID,
      })
      this.onDisconnect(mateID)
    });
  }

  /**
   * Setup connection from clients ('mates')
   *
   * @export
   */
  private setupConnectionAndListeners() {
    // JWT based authentication for socket connections between captain members
    this.io.use(function (socket, next) {
      // const logID = `${SOCKET_SERVER_LOG_ID}(From ${socket.handshake.address})`
      const token = `${socket.handshake.query?.token}`
      const clientOrigin = `${socket.handshake.query?.clientOrigin}`
      if (!clientOrigin) {
        // Important for debugging purpose. can be commented out if needed.
        return next(new Error(`'clientOrigin' not set`))
      }
      if (token) {
        jwt.verify(
          token,
          appConfig.MATE_SECRET_KEY,
          function (err: jwt.VerifyErrors | null, _data: string | jwt.JwtPayload | undefined) {
            if (err) {
              return next(new Error(`Socket authentication failed: reason: ${err?.message}`))
            }
            return next()
          }
        )
      } else {
        return next(new Error(`Socket authentication 'token' not set`))
      }
    })
    this.io.on('connection', async (socket) => {
      this.eachClientConnectionListeners(socket)
    })
    // this.io.engine.on('initial_headers', (headers, _req) => {
    //   logger.info(`${SOCKET_SERVER_LOG_ID}: initial_headers:`, headers)
    // })
    // this.io.engine.on('headers', (headers, _req) => {
    //   logger.info(`${SOCKET_SERVER_LOG_ID}: headers:`, headers)
    // })
    this.io.engine.on('connection_error', (err) => {
      logger.info(`${MATE_SOCKET_SERVER_LOG_ID}: connection_error: details`, {
        'err.code': err.code,
        'err.message': err.message,
        'err.context': err.context,
      })
      logger.debug(`${MATE_SOCKET_SERVER_LOG_ID}: connection_error`, err)
    })
  }

  private constructor(port: number, options?: Partial<ServerOptions>) {
    this.io = new IOServer(port, options)
  }

  public async cleanUpForDeletion() {
    try {
      await closeGivenServer(this.io)
    } catch (e) {
      logger.error(e)
    }
  }

  // Factory to create mate socket server
  public static async createMateSocketServer(port: number, options?: Partial<ServerOptions>) {
    const mateSocketServer = new MateSocketServerManager(port, options)
    mateSocketServer.setupConnectionAndListeners()
    return mateSocketServer
  }

  async onDisconnect(mateID: string) {
    const logID = `${MATE_SOCKET_SERVER_LOG_ID}:onDisconnect`
    try {
      logger.info(logID)
      await processMateDisconnection(mateID)
      if (appState.isLeader() || !appState.getLeaderUrl()) { 
        // Case a). 'leader', re-broadcast to captain 'peers'
        // case b). 'no leader elected', re-broadcast to captain 'peers'
        appState.getSocketManager().broadcastMateDisconnected({
          mate_id: mateID
        })
      } else {
        // Case 'non-leader', send it to captain 'leader'
        appState.getSocketManager().sendMateDisconnected(appState.getLeaderUrl()!, {
          mate_id: mateID
        })
      }
    } catch (e) {
      logger.error(
        new Error(`${logID}: Error Occurred`, {
          cause: e,
        })
      )
    }
  }

  receiveNewRemoteServices(logID: string, payLoad: any) {
    try {
      logger.info(logID, 'receiveNewRemoteServices')
      logger.debug(logID, 'receiveNewRemoteServices: payLoad', payLoad.services)
      // Step 1
      if (appState.isLeader() || !appState.getLeaderUrl()) { 
        // Case a). 'leader', re-broadcast to captain 'peers'
        // case b). 'no leader elected', re-broadcast to captain 'peers'
        appState.getSocketManager().broadcastNewRemoteServices(payLoad)
      } else {
        // Case 'non-leader', send it to captain 'leader'
        appState.getSocketManager().sendNewRemoteServices(appState.getLeaderUrl()!, payLoad)
      }
      // Step2, because the service needs to be in other peers when this is leader and sends active addresses on registration.
      // So, broadcast first and register later
      appState.registerRemoteMateWebServices(payLoad.message_id, payLoad.mate_id, payLoad.services).catch((e) => {
        logger.error(
          new Error(`${logID}: receiveNewRemoteServices: registerGivenMateWebServices: Details: ${payLoad}`, {
            cause: e,
          })
        )  
      })
    } catch (e) {
      logger.error(
        new Error(`${logID}: receiveNewRemoteServices: Details: ${payLoad}`, {
          cause: e,
        })
      )
    }
  }

}
