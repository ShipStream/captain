import jwt from 'jsonwebtoken'
import fs from 'fs/promises'
import YAML from 'yaml'
import {io as ioClient, type Socket as ClientSocket} from 'socket.io-client'
import {
  MATE_EVENT_NAMES,
  registerClientDebugListeners,
} from '../../src/socket/captainSocketHelper.js'
import appConfig from '../../src/appConfig.js'
import { WebServiceManager } from 'web-service/webServiceManager.js'

// Client connection from mates to the main test captain instance
const mockClientSocketManagers: {[key: string]: MockMateClientManager} = {}

function getMateToken(mateID: string) {
  const currentDate = new Date()
  const expiryDate = new Date()
  expiryDate.setHours(expiryDate.getMinutes() + 2)
  const payLoad = {
    sub: appConfig.mateID,
    iat: currentDate.getTime(),
    type: 'ACCESS_TOKEN',
    exp: expiryDate.getTime(),
  }
  return jwt.sign(payLoad, appConfig.MATE_SECRET_KEY)
}

export class MockMateClientManager {
  clientSocket: ClientSocket

  constructor(mainCaptainUnderTest: string, mateID: string) {
    this.clientSocket = ioClient(mainCaptainUnderTest, {query: {token: getMateToken(mateID), clientOrigin: mateID}})
    jest.spyOn(this.clientSocket, 'on')
  }

  private async setupConnectionAndListeners() {}

  public static async createMockSocketClient(mainCaptainUnderTest: string, mateID: string) {
    const mateSocketClientManager = new MockMateClientManager(mainCaptainUnderTest, mateID)
    mateSocketClientManager.setupConnectionAndListeners()
    await registerClientDebugListeners(mateSocketClientManager.clientSocket, mateID)
    return mateSocketClientManager
  }

  cleanUpForDeletion() {
    try {
      this.clientSocket.close()
    } catch (e) {
      console.error(e)
    }
  }
}

async function mockMateClients(mateIDs: string[]) {
  for (const eachMateID of mateIDs) {
    const eachUrl = new URL(eachMateID)
    console.log('initializeSocketClients:each', {
      eachUrl,
    })
    mockClientSocketManagers[eachMateID] = await MockMateClientManager.createMockSocketClient(
      appConfig.SELF_URL,
      eachMateID
    )
  }
}
async function clearMateClients() {
  const mateIDList = Object.keys(mockClientSocketManagers)
  for (const eachMateID of mateIDList) {
    const mockSocketClientManager = mockClientSocketManagers[eachMateID]
    mockSocketClientManager?.cleanUpForDeletion()
    delete mockClientSocketManagers[eachMateID]
  }
}

function receiveServiceStateChangeMessageFromGivenMates(mateList: string[], webServiceManager: WebServiceManager, upstreams: number, healthy: number) {
  for (const eachMateID of mateList) {
    const mockSocketClientManager = mockClientSocketManagers[eachMateID]
    if (mockSocketClientManager) {
      console.log(eachMateID, 'sendServiceStateChangeMessage')
      mockSocketClientManager.clientSocket.emit(MATE_EVENT_NAMES.SERVICE_STATE_CHANGE, {
        mate_id: appConfig.MATE_ID,
        service: webServiceManager.serviceKey,
        upstreams,
        healthy
      })
    } else {
      throw new Error(`Given remote captain "${eachMateID}" is not known/configured/mocked`)
    }
  }
}

let messageIDCounter = 1
async function receiveNewRemoteServicesFromGivenMates(mateList: string[]) {
  for (const eachMateID of mateList) {
    const mockSocketClientManager = mockClientSocketManagers[eachMateID]
    if (mockSocketClientManager) {
      const servicesFile = await fs.readFile(appConfig.WEBSERVICE_YAML_LOCATION, 'utf8')
      const loadedYaml = YAML.parse(servicesFile)
      const servicesPayload = loadedYaml.map((serviceConf: any) => {
        // Send everything except 'mate' property from yaml data
        delete serviceConf.mate;
        return serviceConf
      })
      console.log('receiveNewRemoteServicesFromGivenMates', { servicesPayload })
      mockSocketClientManager.clientSocket.emit(MATE_EVENT_NAMES.NEW_REMOTE_SERVICES, {
        message_id: `${appConfig.MATE_ID}-${messageIDCounter++}`,
        mate_id: appConfig.MATE_ID,
        services: servicesPayload
      })  
      // logger.info('processServiceFileYAML:2', {
      //   loadedYaml: JSON.stringify(loadedYaml, undefined, 2)
      // });  
    } else {
      throw new Error(`Given remote captain "${eachMateID}" is not known/configured/mocked`)
    }
  }
}

const receive = {
  serviceStateChangeMessage: receiveServiceStateChangeMessageFromGivenMates,
  newRemoteServices: receiveNewRemoteServicesFromGivenMates,
}

const socketMockTest = {
  mockMateClients,
  clearMateClients,
  receive,
  mockClientSocketManagers,
}

export default socketMockTest
