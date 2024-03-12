import {Server as IOServer} from 'socket.io'
import {io as ioClient, type Socket as ClientSocket} from 'socket.io-client'
import {
  EVENT_NAMES,
  closeGivenServer,
  getToken,
  registerClientDebugListeners,
} from '../../src/socket/captainSocketHelper.js'
import appConfig from '../../src/appConfig.js'
import {type WebServiceManager} from '../../src/web-service/webServiceManager.js'

// Socket.io servers of the remote captain peers
const ioServers: {[key: string]: IOServer} = {}

// Client connection from remote peers to the main test captain instance
const mockClientSocketManagers: {[key: string]: MockSocketClientManager} = {}

function acknowledge(ackCallback: Function | undefined, status: boolean, acknowledgedBy: string) {
  if (ackCallback) {
    ackCallback({
      acknowledgedBy: acknowledgedBy,
      status: status ? 'ok' : 'error',
    })  
  }  
}

export class MockSocketClientManager {
  clientSocket: ClientSocket

  newLeader(payLoad: any, callback?: Function) {
    acknowledge(callback, true, 'newLeader')
  }
  activeAddresses(payLoad: any, callback?: Function) {
    acknowledge(callback, true, 'activeAddresses')
  }
  bulkActiveAddresses(payLoad: any, callback?: Function) {
    acknowledge(callback, true, 'bulkActiveAddresses')
  }
  healthCheckRequest(payLoad: any, callback?: Function) {
    acknowledge(callback, true, 'healthCheckRequest')
  }
  changePollingFrequency(payLoad: any, callback?: Function) {
    acknowledge(callback, true, 'changePollingFrequency')
  }
  healthCheckUpdate(payLoad: any, callback?: Function) {
    acknowledge(callback, true, 'healthCheckUpdate')
  }
  bulkHealthCheckUpdate(payLoad: any, callback?: Function) {
    acknowledge(callback, true, 'bulkHealthCheckUpdate')
  }
  newRemoteServices(payLoad: any, callback?: Function) {
    acknowledge(callback, true, 'newRemoteServices')
  }
  mateDisconnected(payLoad: any, callback?: Function) {
    acknowledge(callback, true, 'mateDisconnected')
  }

  constructor(targetServerUrl: string, clientCaptainUrl: string) {
    this.clientSocket = ioClient(targetServerUrl, {query: {token: getToken(), clientOrigin: clientCaptainUrl}})
    jest.spyOn(this.clientSocket, 'on')
  }

  setupConnectionAndListeners() {
    this.clientSocket.on(EVENT_NAMES.NEW_LEADER, this.newLeader)
    this.clientSocket.on(EVENT_NAMES.ACTIVE_ADDRESSES, this.activeAddresses)
    this.clientSocket.on(EVENT_NAMES.BULK_ACTIVE_ADDRESSES, this.bulkActiveAddresses)
    this.clientSocket.on(EVENT_NAMES.HEALTH_CHECK_REQUEST, this.healthCheckRequest)
    this.clientSocket.on(EVENT_NAMES.REQUEST_CHANGE_POLLING_FREQ, this.changePollingFrequency)
    this.clientSocket.on(EVENT_NAMES.HEALTH_CHECK_UPDATE, this.healthCheckUpdate)
    this.clientSocket.on(EVENT_NAMES.BULK_HEALTH_CHECK_UPDATE, this.bulkHealthCheckUpdate)
    this.clientSocket.on(EVENT_NAMES.NEW_REMOTE_SERVICES, this.newRemoteServices)
    this.clientSocket.on(EVENT_NAMES.MATE_DISCONNECTED, this.mateDisconnected)
  }

  public static async createMockSocketClient(mainCaptainUnderTest: string, eachCaptainUrl: string) {
    const captainSocketClientManager = new MockSocketClientManager(mainCaptainUnderTest, eachCaptainUrl)
    captainSocketClientManager.setupConnectionAndListeners()
    await registerClientDebugListeners(captainSocketClientManager.clientSocket, eachCaptainUrl)
    return captainSocketClientManager
  }

  cleanUpForDeletion() {
    try {
      this.clientSocket.close()
    } catch (e) {
      console.error(e)
    }
  }
}

jest.spyOn(MockSocketClientManager.prototype, 'newLeader')
jest.spyOn(MockSocketClientManager.prototype, 'activeAddresses')
jest.spyOn(MockSocketClientManager.prototype, 'bulkActiveAddresses')
jest.spyOn(MockSocketClientManager.prototype, 'healthCheckRequest')
jest.spyOn(MockSocketClientManager.prototype, 'changePollingFrequency')
jest.spyOn(MockSocketClientManager.prototype, 'healthCheckUpdate')
jest.spyOn(MockSocketClientManager.prototype, 'bulkHealthCheckUpdate')
jest.spyOn(MockSocketClientManager.prototype, 'newRemoteServices')
jest.spyOn(MockSocketClientManager.prototype, 'mateDisconnected')

async function mockRemoteCaptains(otherCaptainUrls: string[]) {
  for (const eachCaptainUrl of otherCaptainUrls) {
    const eachUrl = new URL(eachCaptainUrl)
    console.log('initializeSocketServers:each', {
      eachUrl,
    })
    const ioServer = new IOServer(Number(eachUrl.port))
    ioServers[eachCaptainUrl] = ioServer
    // Helps identify the connection establishment for tests
    ioServer.on('connection', async (socket) => {
      socket.emit(EVENT_NAMES.BULK_HEALTH_CHECK_UPDATE, [])

      // after the main-test-captain-server establish connection to this peer ioServer, establish back,
      // client connect with it
      mockClientSocketManagers[eachCaptainUrl] = await MockSocketClientManager.createMockSocketClient(
        appConfig.SELF_URL,
        eachCaptainUrl
      )
    })
  }
}

function receiveHealthCheckUpdateBroadcastFromAllPeers(
  webService: WebServiceManager,
  {
    ipAddress,
    failing,
    passing,
  }: {
    ipAddress: string
    failing: number
    passing: number
  }
) {
  return receiveHealthCheckUpdateBroadcastFromPeer(Object.keys(ioServers), webService, {
    ipAddress,
    failing,
    passing,
  })
}

function receiveHealthCheckUpdateBroadcastFromPeer(
  remoteCaptains: string[],
  webService: WebServiceManager,
  {ipAddress, failing, passing}: {ipAddress: string; failing: number; passing: number}
) {
  if (failing && passing) {
    throw new Error("Can have non-zero for only 'failing' or 'passing'")
  }
  for (const eachCaptainMemberUrl of remoteCaptains) {
    const socketIOServer = ioServers[eachCaptainMemberUrl]
    if (socketIOServer) {
      socketIOServer.emit(EVENT_NAMES.HEALTH_CHECK_UPDATE, {
        member: eachCaptainMemberUrl,
        service: webService.serviceKey,
        address: ipAddress,
        failing: failing,
        passing: passing,
        last_update: new Date(),
      })
    } else {
      throw new Error(`Given remote captain "${eachCaptainMemberUrl}" is not known/configured/mocked`)
    }
  }
}

const receive = {
  healthCheckUpdateBroadcastFromAllPeers: receiveHealthCheckUpdateBroadcastFromAllPeers,
  healthCheckUpdateBroadcastFromPeer: receiveHealthCheckUpdateBroadcastFromPeer,
}

async function clearRemoteCaptains() {
  let otherCaptainUrls = Object.keys(ioServers)
  for (const eachCaptainUrl of otherCaptainUrls) {
    await closeGivenServer(ioServers[eachCaptainUrl]!)
    delete ioServers[eachCaptainUrl]
  }

  otherCaptainUrls = Object.keys(mockClientSocketManagers)
  for (const eachCaptainUrl of otherCaptainUrls) {
    const mockSocketClientManager = mockClientSocketManagers[eachCaptainUrl]
    mockSocketClientManager?.cleanUpForDeletion()
    delete mockClientSocketManagers[eachCaptainUrl]
  }
}

const socketMockTest = {
  mockRemoteCaptains,
  clearRemoteCaptains,
  receive,
  mockClientSocketManagers,
  ioServers,
}

export default socketMockTest