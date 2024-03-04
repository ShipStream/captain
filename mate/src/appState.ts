import appConfig from './appConfig.js'
import {WebServiceManager, typeWebServiceConf} from './webServiceManager.js'
import {SocketClientManager} from './SocketClientManager.js'
import {CustomRaceConditionLock, logger} from './coreUtils.js'

class AppState {
  // 'State' (Hash) of all web services.
  // Using zone record as unique key.
  private _webServices: {
    [key: string]: WebServiceManager
  } = {}

  deleteWebService(serviceKey: string) {
    const oldWebService = this._webServices[serviceKey]
    if (oldWebService) {
      oldWebService.cleanUpForDeletion()
      delete this._webServices[serviceKey]  
    }
  }

  setWebService(webService: WebServiceManager) {
    // If service is already registered, delete old one and register with the new configuration
    const serviceKey = webService.serviceKey
    if (this._webServices[serviceKey]) {
      this.deleteWebService(serviceKey)
    }
    this._webServices[serviceKey] = webService
  }

  getWebService(key: string) {
    return this._webServices[key]
  }

  getWebServices() {
    return this._webServices
  }

  /**
   * Initiate a manager ('WebServiceManager') for each 'web service' to be managed by the 'captain'.
   * Store 'instance' into global state.
   * @export
   * @param {typeWebServiceConf []} serviceConfs
   */
  async registerWebServices(serviceConfs: typeWebServiceConf[]) {
    const registerServicePromises = []
    for (const serviceConf of serviceConfs) {
      registerServicePromises.push(
        WebServiceManager.createWebService(serviceConf).then((webService: WebServiceManager) => {
          this.setWebService(webService)
        })
      )
    }
    await Promise.all(registerServicePromises)
  }

  raceHandler!: CustomRaceConditionLock

  getRaceHandler() {
    return this.raceHandler
  }

  /**
   * Create a CustomRaceConditionLock
   */
  async registerRaceHandler() {
    if (this.raceHandler) {
      this.raceHandler.cleanUpForDeletion()
    }
    this.raceHandler = new CustomRaceConditionLock()
  }

  async resetAppState({resetSockets, resetWebApps}: {resetSockets: boolean; resetWebApps: boolean}) {
    if (resetSockets) {
      appState.getSocketManager().cleanUpForDeletion()
    }
    if (resetWebApps) {
      // logger.info('softReloadApp:Step3:delete all webservices')
      const webServicesKeys = Object.keys(appState.getWebServices())
      for (const eachServiceKey of webServicesKeys) {
        // logger.info('softReloadApp:eachServiceKey', eachServiceKey)
        this.deleteWebService(eachServiceKey)
      }
    }
  }

  constructor() {}

  private _socketManager!: SocketClientManager

  setSocketManager(newSocketManager: SocketClientManager) {
    this._socketManager?.cleanUpForDeletion() // cleanup old manager if it exists
    this._socketManager = newSocketManager
  }

  getSocketManager() {
    return this._socketManager
  }

  /**
   * Create a socket client for communication with the given captain
   * Initialize and store the socket 'instance' into global state.
   *
   * @export
   */
  async establishConnectionWithGivenCaptain(captainUrl: string) {
    const CONN_TIMEOUT_IN_SEC = 60
    const startTime = Date.now()
    const connectionStates: {
      CANCEL_CONN: boolean
      CONN_ERROR?: any
      newSocketManager?: SocketClientManager
    } = {
      CANCEL_CONN: false,
      CONN_ERROR: undefined,
      newSocketManager: undefined,
    }

    // Init Create connection
    SocketClientManager.createCaptainSocketClient(captainUrl)
      .then((newSocketManager) => {
        if (connectionStates.CANCEL_CONN) {
          newSocketManager.cleanUpForDeletion()
        } else {
          // Success within time out, so set as the main connection
          connectionStates.newSocketManager = newSocketManager
        }
      })
      .catch((e: any) => {
        connectionStates.CONN_ERROR = e
      })

    //wait until CONN_TIMEOUT_IN_SEC to decide on connection success
    return await new Promise((resolve, reject) => {
      const timerRef = setInterval(async () => {
        const timePassedInSeconds = (Date.now() - startTime) / 1000
        logger.debug('establishConnectionWithGivenCaptain', {
          timePassedInSeconds,
          CONN_ERROR: connectionStates.CONN_ERROR,
          timedOut: timePassedInSeconds >= CONN_TIMEOUT_IN_SEC,
          CONN_SUCCESS: connectionStates.newSocketManager?.clientSocket?.connected,
        })
        if (connectionStates.newSocketManager?.clientSocket?.connected) {
          clearInterval(timerRef)
          this.setSocketManager(connectionStates.newSocketManager!)
          return resolve(true)
        } else {
          if (connectionStates.CONN_ERROR || timePassedInSeconds >= CONN_TIMEOUT_IN_SEC) {
            // Conn errored out (or) Conn timed out
            clearInterval(timerRef)
            connectionStates.CANCEL_CONN = true
            connectionStates.newSocketManager?.cleanUpForDeletion()
            return resolve(false)
          }
        }
      }, 1000)
    })
  }

  /**
   * Create a socket client for communication with captain
   * Choose among the given captain list for connection
   *
   * @export
   */
  async establishConnectionWithCaptain() {
    // Delete any exising connections
    this.getSocketManager()?.cleanUpForDeletion()
    // Rotate the captains and wait for successful connection indefinitely
    // Because, 'mate' cannot function without a 'captain' to support it
    while(!this.getSocketManager()?.clientSocket?.connected) {
      for (const eachCaptainUrl of appConfig.CAPTAIN_URL) {
        // appConfig.CAPTAIN_URL is list of available captain instances
        const connectionStatus = await this.establishConnectionWithGivenCaptain(eachCaptainUrl)
        if (connectionStatus) {
          break
        }
      }
    }
  }

  messageIDCounter = 1

  /**
   * Unique id to identify each message sent over the socket,
   * helps avoid message processing duplication
   *
   * @export
   */
  generateMessageID(messageType: string) {
    return `ID/${appConfig.MATE_ID}/${messageType}/${++this.messageIDCounter}/${new Date().toISOString()}`
  }  

}

const appState = new AppState()

export default appState
