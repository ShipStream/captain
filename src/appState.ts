// import {logger} from './coreUtils.js'
import { type ServerOptions } from 'socket.io'
import type { Socket as ClientSocket } from 'socket.io-client'
import appConfig from './appConfig.js'
import { typeWebServiceConf } from './web-service/webServiceHelper.js'
import { WebServiceManager } from './web-service/webServiceManager.js'
import { CaptainSocketServerManager } from './socket/SocketServerManager.js'
import { CustomRaceConditionLock, logger } from './coreUtils.js'
import { SOCKET_CLIENT_LOG_ID } from './socket/captainSocketHelper.js'
import { SocketClientManager } from './socket/SocketClientManager.js'

class AppState {
  // 'State' (Hash) of all web services.
  // Using zone record as unique key.
  webServices: {
    [key: string]: WebServiceManager
  } = {}

  /**
   * Initiate a manager ('WebServiceManager') for each 'web service' to be managed by the 'captain'.
   * Store 'instance' into global state.
   * @export
   * @param {typeWebServiceConf []} serviceConfs
   */
  async registerWebServices(serviceConfs: typeWebServiceConf[]) {
    const registerServicePromises = []
    for (const serviceConf of serviceConfs) {
      registerServicePromises.push(WebServiceManager.createWebService(serviceConf).then((webService: WebServiceManager) => {
        this.webServices[webService.serviceKey] = webService
      }))
    }
    await Promise.all(registerServicePromises)
  }

  constructor() {
    // Output 'state' for debugging
    // setInterval(() => {
    //   logger.info(
    //     'appState:webServices',
    //     JSON.stringify(
    //       Object.keys(this.webServices).map((eachKey) => {
    //         return this.webServices[eachKey]?.serviceState
    //       }),
    //       undefined,
    //       2
    //     )
    //   )
    //   logger.info('appState:leader', {
    //     'getLeaderUrl()': this.getLeaderUrl(),
    //     'isLeader()': this.isLeader(),
    //   })
    // }, 5000)
  }
  // Maintain 'state' about leader of the 'captains'
  leaderURL?: string

  setLeaderUrl(inputLeaderUrl: string) {
    this.leaderURL = inputLeaderUrl
  }

  getLeaderUrl() {
    return this.leaderURL
  }

  /**
   * If stored 'leaderUrl' is same as 'url' of current instance, then return 'true'
   *
   * @export
   * @return {*}  {boolean}
   */
  isLeader(): boolean {
    return this.leaderURL === appConfig.SELF_URL
  }

  socketManager!: CaptainSocketServerManager

  getSocketManager() {
    return this.socketManager
  }

  /**
   * Create a socket server for communication between captain 'peers'
   * Initialize and store the socket 'instance' into global state.
   *
   * @export
   * @param {number} port
   * @param {Partial<ServerOptions>} [options]
   */
  async registerCaptainSocketServer(port: number, options?: Partial<ServerOptions>) {
    this.socketManager = await CaptainSocketServerManager.createCaptainSocketServer(port, options)
  }

  remoteCaptainUrlVsClientSocketManager: {
    [key: string]: SocketClientManager
  } = {}
  
  async connectWithOtherCaptains(otherCaptains: string[]) {
    try {
      logger.info(`${SOCKET_CLIENT_LOG_ID}: connectWithOtherCaptains`, otherCaptains)

      const clientSocketManagerPromises = []
      for (const eachCaptainUrl of otherCaptains) {
        clientSocketManagerPromises.push(SocketClientManager.createCaptainSocketClient(eachCaptainUrl).then((socketClientManager: SocketClientManager) => {
          this.remoteCaptainUrlVsClientSocketManager[eachCaptainUrl] = socketClientManager
        }).catch((e: any) => {
          logger.error(
            new Error(
              `${SOCKET_CLIENT_LOG_ID}: error with connectAndRegisterListenerWithOtherCaptain: ${eachCaptainUrl}`,
              { cause: e }
            )
          )
          throw e
        }))
      }
      await Promise.all(clientSocketManagerPromises)
    } catch (e) {
      logger.error(
        new Error(`${SOCKET_CLIENT_LOG_ID}: error with connectWithOtherCaptains: ${otherCaptains}`, {
          cause: e,
        })
      )
    }
  }
  
  raceHandler!: CustomRaceConditionLock

  getRaceHandler() {
    return this.raceHandler
  }

  /**
   * Create a CustomRaceConditionLock
   */
  async registerRaceHandler() {
    this.raceHandler = new CustomRaceConditionLock()
  }

  async resetAppState({ resetSockets, resetWebApps, resetLockHandlers }: { resetSockets: boolean, resetWebApps: boolean, resetLockHandlers: boolean }) {
    if (resetSockets) {
      // console.log('softReloadApp:Step1:terminate socket server connections')
      await appState.getSocketManager().cleanUpForDeletion()
      // console.log('softReloadApp:Step2:terminate socket client connections')
      const remoteCaptains = Object.keys(appState.remoteCaptainUrlVsClientSocketManager)
      const remoteCaptainUrlVsClientSocketManager = appState.remoteCaptainUrlVsClientSocketManager
      for (const eachRemoteCaptainUrl of remoteCaptains) {
        // console.log('softReloadApp:eachRemoteCaptainUrl', eachRemoteCaptainUrl)
        const eachClientSocketManager = remoteCaptainUrlVsClientSocketManager[eachRemoteCaptainUrl]
        eachClientSocketManager?.cleanUpForDeletion()
        delete remoteCaptainUrlVsClientSocketManager[eachRemoteCaptainUrl]
      }
    }
    if (resetWebApps) {
      // console.log('softReloadApp:Step3:delete all webservices')
      const webServicesKeys = Object.keys(appState.webServices)
      const webServices = appState.webServices
      for (const eachServiceKey of webServicesKeys) {
        // console.log('softReloadApp:eachServiceKey', eachServiceKey)
        const eachWebService = webServices[eachServiceKey]
        eachWebService?.cleanUpForDeletion()
        delete webServices[eachServiceKey]
      }
    }
    if (resetLockHandlers) {
      appState.getRaceHandler().cleanUpForDeletion()
    }  
  }
}

const appState = new AppState()

export default appState
