import { MATE_EVENT_NAMES } from './../../src/SocketClientManager.js'
import { logger } from './../../src/coreUtils.js'
import {Server as IOServer, Socket as ServerSocket} from 'socket.io'
import commonTest from './commonTest.utils.js'

export function closeGivenServer(server?: IOServer) {
  if (server) {
    return new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          logger.error('Error closing connections', err?.message || err)
          return reject(err)
        }
        return resolve()
      })
    })
  }
}

function acknowledge(ackCallback: Function | undefined, status: boolean, acknowledgedBy: string) {
  if (ackCallback) {
    ackCallback({
      acknowledgedBy: acknowledgedBy,
      status: status ? 'ok' : 'error',
    })
  }
}

// Mock the socket.io server of the captain that receives the 'events' from connected mate
export class MockCaptainSocketServer {
  captainUrl: string
  ioServer: IOServer
  socket?: ServerSocket

  setSocket(newSocket: ServerSocket) {
    // Another connection when previous one exists
    if (this.socket?.connected) {
      throw new Error('Only a single client (Main mate instance) expected to connect. Multiple clients not expected')
    }
    this.socket = newSocket
  }

  // receive 'NEW_REMOTE_SERVICES' from connected 'mate'
  newRemoteServices(payLoad: any, callback?: Function) {
    logger.info('MockCaptainSocketServer:received', MATE_EVENT_NAMES.NEW_REMOTE_SERVICES)
    acknowledge(callback, true, 'newRemoteServices')
  }

  // receive 'SERVICE_STATE_CHANGE' from connected 'mate'
  serviceStateChange(payLoad: any, callback?: Function) {
    logger.info('MockCaptainSocketServer:received', MATE_EVENT_NAMES.SERVICE_STATE_CHANGE)
    acknowledge(callback, true, 'serviceStateChange')
  }

  eachMateConnectionAndListeners(socket: ServerSocket) {
    const mateID = `${socket.handshake.query?.clientOrigin}`
    const logID = `MATE_SOCKET_SERVER_LOG_ID(Remote Client: ${mateID})`
    logger.info(`${logID}: New connection: registerListeners`, {
      new: [socket.id, mateID],
    })
    socket.on(MATE_EVENT_NAMES.NEW_REMOTE_SERVICES, this.newRemoteServices)
    socket.on(MATE_EVENT_NAMES.SERVICE_STATE_CHANGE, this.serviceStateChange)
    socket.on("disconnect", async (reason) => {
      commonTest.attentionLog(logID, 'disconnect', {
        reasonForDisconnection: reason,
        disconnectingMate: mateID,
      })
    });
  }
  
  constructor(inputCaptainUrl: string) {
    this.captainUrl = inputCaptainUrl
    const captainURLObject = new URL(this.captainUrl)
    logger.info('initializeSocketServers:captainURLObject', {
      captainURLObject,
    })
    this.ioServer = new IOServer(Number(captainURLObject.port))
    // Helps identify the connection establishment for tests
    this.ioServer.on('connection', async (socket) => {
      commonTest.attentionLog('connection', { socketDetails: socket.handshake })
      this.setSocket(socket)
      this.eachMateConnectionAndListeners(socket)
    })
  }

}

jest.spyOn(MockCaptainSocketServer.prototype, 'newRemoteServices')
jest.spyOn(MockCaptainSocketServer.prototype, 'serviceStateChange')

// Socket.io servers of the remote captains
const captainServers: {[key: string]: MockCaptainSocketServer} = {}

async function mockRemoteCaptains(captainUrls: string[]) {
  for (const eachCaptainUrl of captainUrls) {
    captainServers[eachCaptainUrl] = new MockCaptainSocketServer(eachCaptainUrl)
  }
}

async function clearRemoteCaptains() {
  let otherCaptainUrls = Object.keys(captainServers)
  for (const eachCaptainUrl of otherCaptainUrls) {
    await closeGivenServer(captainServers?.[eachCaptainUrl]?.ioServer)
    delete captainServers[eachCaptainUrl]
  }
}

const socketMockTest = {
  mockRemoteCaptains,
  clearRemoteCaptains,
  captainServers,
}

export default socketMockTest
