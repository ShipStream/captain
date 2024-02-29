/*
  The purpose of this file is to simulate the presense of mate(s) and send message to the captain.
  So that we can test/verify, how the captain handles the interaction.
*/

import jwt from 'jsonwebtoken'
import fs from 'fs/promises'
import YAML from 'yaml'
import {io as ioClient, type Socket as ClientSocket} from 'socket.io-client'
import {
  MATE_EVENT_NAMES,
  registerClientDebugListeners,
} from '../../src/socket/captainSocketHelper.js'

const matesAppConfig = [
  {
    MATE_ID: 'mate-test-1',
    CAPTAIN_URL: process.env.__MATE_COMMON__CAPTAIN_URL,
    CAPTAIN_SECRET_KEY: process.env.__MATE_COMMON__CAPTAIN_SECRET_KEY,
    WEBSERVICE_YAML_LOCATION: process.env.__MATE_TEST_1__WEBSERVICE_YAML_LOCATION,
  },
  {
    MATE_ID: 'mate-test-2',
    CAPTAIN_URL: process.env.__MATE_COMMON__CAPTAIN_URL,
    CAPTAIN_SECRET_KEY: process.env.__MATE_COMMON__CAPTAIN_SECRET_KEY,
    WEBSERVICE_YAML_LOCATION: process.env.__MATE_TEST_2__WEBSERVICE_YAML_LOCATION,
  }
]

function getMateIDs() {
  return matesAppConfig.map((eachConf) => {
    return eachConf.MATE_ID
  })
}

function getMateConf(mateID: string) {
  return matesAppConfig.filter((eachConf) => {
    return eachConf.MATE_ID === mateID
  })?.[0]
}

// Client connection from mates to the main test captain instance
const mockClientSocketManagers: {[key: string]: MockMateClientManager} = {}

function getMateToken(mateID: string) {
  const currentDate = new Date()
  const expiryDate = new Date()
  expiryDate.setHours(expiryDate.getMinutes() + 2)
  const payLoad = {
    sub: mateID,
    iat: currentDate.getTime(),
    type: 'ACCESS_TOKEN',
    exp: expiryDate.getTime(),
  }
  return jwt.sign(payLoad, getMateConf(mateID)!.CAPTAIN_SECRET_KEY!)
}

export class MockMateClientManager {
  clientSocket: ClientSocket

  constructor(mainCaptainUnderTest: string, mateID: string) {
    this.clientSocket = ioClient(mainCaptainUnderTest, {query: {token: getMateToken(mateID), clientOrigin: mateID}})
    jest.spyOn(this.clientSocket, 'on')
  }

  private async setupConnectionAndListeners() {}

  public static async createMockSocketClient(captainUrl: string, mateID: string) {
    const mateSocketClientManager = new MockMateClientManager(captainUrl, mateID)
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
    const mateConf = getMateConf(eachMateID)!
    mockClientSocketManagers[eachMateID] = await MockMateClientManager.createMockSocketClient(
      mateConf.CAPTAIN_URL!,
      eachMateID
    )
  }
}

async function disconnectClients(mateIDList: string[]) {
  for (const eachMateID of mateIDList) {
    const mockSocketClientManager = mockClientSocketManagers[eachMateID]
    mockSocketClientManager?.cleanUpForDeletion()
    delete mockClientSocketManagers[eachMateID]
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

/**
 * Send 'service-state-change' message from each of the given mates to their respective, connected captain
 *
 */
function emitServiceStateChangeMessageFromGivenMates(mateList: string[], serviceKey: string, upstreams: number, healthy: number) {
  for (const eachMateID of mateList) {
    const mateConf = getMateConf(eachMateID)
    const mockSocketClientManager = mockClientSocketManagers[eachMateID]
    if (mockSocketClientManager) {
      console.log(eachMateID, 'receiveServiceStateChangeMessageFromGivenMates')
      mockSocketClientManager.clientSocket.emit(MATE_EVENT_NAMES.SERVICE_STATE_CHANGE, {
        mate_id: eachMateID,
        service: serviceKey,
        upstreams,
        healthy
      })
    } else {
      throw new Error(`Given remote captain "${eachMateID}" is not known/configured/mocked`)
    }
  }
}

let messageIDCounter = 1
/**
 * Send 'new-remote-services' message from each of the given mates to their respective, connected captain
 *
 */
async function emitNewRemoteServicesFromGivenMates(mateList: string[]) {
  console.log('emitNewRemoteServicesFromGivenMates:1', {
    mateList,
    mockClientSocketManagers,
  })
  for (const eachMateID of mateList) {
    const mockSocketClientManager = mockClientSocketManagers[eachMateID]
    console.log('emitNewRemoteServicesFromGivenMates:2', {
      mateList,
      mockClientSocketManagers,
    })
    if (mockSocketClientManager) {
      const mateConf = getMateConf(eachMateID)!
      console.log('emitNewRemoteServicesFromGivenMates:3', {
        mateConf,
      })
      const servicesFile = await fs.readFile(mateConf.WEBSERVICE_YAML_LOCATION!, 'utf8')
      // console.log('emitNewRemoteServicesFromGivenMates:4', { servicesFile, file: mateConf.WEBSERVICE_YAML_LOCATION })
      const loadedYaml = YAML.parse(servicesFile)
      // console.log('emitNewRemoteServicesFromGivenMates:5', { loadedYaml })
      const servicesPayload = loadedYaml?.services.map((serviceConf: any) => {
        // Send everything except 'mate' property from yaml data
        delete serviceConf.mate;
        return serviceConf
      })
      // console.log('emitNewRemoteServicesFromGivenMates:6', { servicesPayload })
      mockSocketClientManager.clientSocket.emit(MATE_EVENT_NAMES.NEW_REMOTE_SERVICES, {
        message_id: `${eachMateID}-${messageIDCounter++}`,
        mate_id: eachMateID,
        services: servicesPayload
      })
      // console.log('emitNewRemoteServicesFromGivenMates:6', { eachMateID, servicesPayload })
    } else {
      throw new Error(`Given remote captain "${eachMateID}" is not known/configured/mocked`)
    }
  }
}

const mateMockTest = {
  getMateIDs,
  getMateConf,
  mockMateClients,
  disconnectClients,
  clearMateClients,
  mockClientSocketManagers,
  emitServiceStateChangeMessageFromGivenMates,
  emitNewRemoteServicesFromGivenMates,  
}

export default mateMockTest
