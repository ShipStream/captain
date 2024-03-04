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
import { ConsulService } from './ConsulService.js'
import { NotificationService } from './NotificationService.js'
import { MateSocketServerManager } from './socket/MateSocketServerManager.js'

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

  /**
   * Register the given webservice reference into the system
   * If old service data exists, it will be cleaned and replace with new one
   *
   * @param {WebServiceManager} webService
   * @memberof AppState
   */
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
   * Process 'static' set of web services received read from services YAML
   * Initiate a manager ('WebServiceManager') for each 'web service' to be managed by the 'captain'.
   * Store 'instance' into global state.
   * @export
   * @param {typeWebServiceConf []} serviceConfs
   */
  async registerLocalWebServices(serviceConfs: typeWebServiceConf[]) {
    const registerServicePromises = []
    for (const serviceConf of serviceConfs) {
      logger.info('registerLocalWebServices:initiate', serviceConf.name)
      registerServicePromises.push(
        WebServiceManager.createLocalWebService(serviceConf).then((webService: WebServiceManager) => {
          this.setWebService(webService)
          logger.info('registerLocalWebServices:success', webService.serviceKey)          
        })
      )
    }
    await Promise.all(registerServicePromises)
    logger.info('registerLocalWebServices:completeAll')
  }

  // Processing all mate services is an expensive operation and hence using message_id key to avoid reprocessing
  processedRemoteMessages: {[key: string]: number} = {}

  markRemoteMessageProcessed(messageID: string) {
    const processingDateTime = Date.now()
    this.processedRemoteMessages[messageID] = processingDateTime
  }

  isRemoteMessageAlreadyProcessed(messageID: string) {
    // Check the message processed cached and return status
    // MessageID can be optional too, mostly in case of bulk messages, so skip uniqueness check when not present
    if (!messageID || !this.processedRemoteMessages[messageID]) {
      return false
    }
    return true
  }

  cleanUpProcessedMessageIDTrackerRef: any
  // Cleanup handler for above object 'processedRemoteMessages'
  initCleanUpProcessedMessageIDTracker() {
    this.cleanUpProcessedMessageIDTrackerRef = setInterval(() => {
      const messageIDKeys = Object.keys(this.processedRemoteMessages)
      for (const eachMessageID of messageIDKeys) {
        const processingTime = this.processedRemoteMessages[eachMessageID]!
        const timePassedInSeconds = (Date.now() - processingTime) / 1000
        if (timePassedInSeconds > 900) {
          //15 mintues older, delete to free up memory
          delete this.processedRemoteMessages[eachMessageID]
          logger.debug('cleanupMessageTracker', {eachMessageID, timePassedInSeconds})
        }
      }
    }, 60 * 1000)
  }

  cleanUpProcessedRemoteMessageTracker() {
    if (this.cleanUpProcessedMessageIDTrackerRef) {
      clearInterval(this.cleanUpProcessedMessageIDTrackerRef)
    }
    this.processedRemoteMessages = {}    
  }

  async createOrMergeRemoteWebService(mateID: string, serviceConf: typeWebServiceConf) {
    // Multiple mate could simultaneously report data for same service. So avoid parallel processing with the help of locks
    let raceCondLock
    try {
      const serviceKey = serviceConf.name
      raceCondLock = await appState.getRaceHandler().getLock(`createRemoteWebService:${serviceKey}`, 90 * 1000)
      if (this.getWebService(serviceKey)) {
        // Service already exists, so merge configuration instead of creating new service
        const existingService = this.getWebService(serviceKey)!
        const mergedWebService = await existingService.mergeWebServiceConf(mateID, serviceConf)
        logger.info('createOrMergeRemoteWebService:merged', mergedWebService.logID)
      } else {
        const newWebService = await WebServiceManager.createRemoteWebService(mateID, serviceConf)
        this.setWebService(newWebService)
        logger.info('createOrMergeRemoteWebService:created', newWebService.logID)
        logger.debug('createOrMergeRemoteWebService:created:details', newWebService.logID, {
          serviceConf: newWebService.serviceConf,
          serviceState: newWebService.serviceState,
        })
      }
    } finally {
      appState.getRaceHandler().releaseLock(raceCondLock)
    }
  }

  /**
   * Process additional dynamic sets of web services received from accompanying 'mates'
   * Initiate a manager ('WebServiceManager') for each 'web service' to be managed by the 'captain'.
   * Store 'instance' into global state.
   * @export
   * @param {typeWebServiceConf []} serviceConfs
   */
  async registerRemoteMateWebServices(messageID: string, mateID: string, serviceConfs: typeWebServiceConf[]) {
    const logID = `registerRemoteMateWebServices:${mateID}:${messageID}:`
    logger.debug(logID, 'details:', {
      messageID,
      mateID,
      serviceConfs,
      lastProcessed: this.processedRemoteMessages[messageID],
    })
    // Check and do processing only if it is not already processed for performance reasons.
    if (!this.isRemoteMessageAlreadyProcessed(messageID)) {
      logger.info(logID ,'processing')
      this.markRemoteMessageProcessed(messageID)
      const registerServicePromises = []
      for (const serviceConf of serviceConfs) {
        registerServicePromises.push(this.createOrMergeRemoteWebService(mateID, serviceConf))
      }
      await Promise.all(registerServicePromises)
      logger.info(logID ,'complete')
    } else {
      logger.info(logID ,'already processed')
    }
  }

  /**
   * Get all services belonging to the mate and 'mark' them as orphan and let captain take over polling
   *
   * @export
   */
  async processMateDisconnection(messageID: string, mateID: string) {
    const logID = `processMateDisconnection:${mateID}:${messageID}:`
    if (!this.isRemoteMessageAlreadyProcessed(messageID)) {
      logger.info(logID, 'processing')
      this.markRemoteMessageProcessed(messageID)
      const allServices = appState.getWebServices()
      for(const eachService of Object.values(allServices)) {
        if (eachService.serviceConf.is_remote && eachService.containsMate(mateID)) {
          logger.info(logID, eachService.serviceKey)
          eachService.updateMateParameters(mateID, {
            is_orphan: true,
            last_update: new Date()
          })
          eachService.restartPolling()
        }
      }
      logger.info(logID, 'complete')
    } else {
      logger.info(logID, 'already processed')
    }
  }

  constructor() {
    this.initCleanUpProcessedMessageIDTracker()
  }

  // Maintain 'state' about leader of the 'captains'
  leaderURL?: string

  setLeaderUrl(inputLeaderUrl?: string) {
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

  _socketManager!: CaptainSocketServerManager

  setSocketManager(newSocketManager: CaptainSocketServerManager) {
    this._socketManager?.cleanUpForDeletion() // cleanup old manager if it exists
    this._socketManager = newSocketManager
  }

  getSocketManager() {
    return this._socketManager
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
    const newSocketManager = await CaptainSocketServerManager.createCaptainSocketServer(port, options)
    this.setSocketManager(newSocketManager)
  }

  _mateSocketManager!: MateSocketServerManager

  setMateSocketManager(newSocketManager: MateSocketServerManager) {
    this._mateSocketManager?.cleanUpForDeletion() // cleanup old manager if it exists
    this._mateSocketManager = newSocketManager
  }

  getMateSocketManager() {
    return this._mateSocketManager
  }

  /**
   * Create a socket server for communication from mates
   * Initialize and store the socket 'instance' into global state.
   *
   * @export
   * @param {number} port
   * @param {Partial<ServerOptions>} [options]
   */
  async registerMateSocketServer(port: number, options?: Partial<ServerOptions>) {
    const newMateSocketManager = await MateSocketServerManager.createMateSocketServer(port, options)
    this.setMateSocketManager(newMateSocketManager)
  }

  _remoteCaptainUrlVsClientSocketManager: {
    [key: string]: SocketClientManager
  } = {}

  deleteClientSocketManagerByRemoteUrl(remoteCaptainUrl: string) {
    const oldClientSocketManager = this._remoteCaptainUrlVsClientSocketManager[remoteCaptainUrl]
    if (oldClientSocketManager) {
      oldClientSocketManager?.cleanUpForDeletion()
      delete this._remoteCaptainUrlVsClientSocketManager[remoteCaptainUrl]
    }
  }

  getClientSocketManagerByRemoteUrl(remoteCaptainUrl: string) {
    return this._remoteCaptainUrlVsClientSocketManager[remoteCaptainUrl]
  }

  setClientSocketManagerForRemoteUrl(remoteCaptainUrl: string, clientSocketManager: SocketClientManager) {
    // Cleanup old connection with the given remote captain if exists
    this.deleteClientSocketManagerByRemoteUrl(remoteCaptainUrl)
    this._remoteCaptainUrlVsClientSocketManager[remoteCaptainUrl] = clientSocketManager
  }

  getAllClientSocketManagers() {
    return this._remoteCaptainUrlVsClientSocketManager
  }

  getAllConnectedRemoteCaptainServers() {
    return Object.keys(this._remoteCaptainUrlVsClientSocketManager).filter((eachCaptainUrl) => {
      return this._remoteCaptainUrlVsClientSocketManager[eachCaptainUrl]?.clientSocket.connected
    })
  }


  async connectWithOtherCaptains(otherCaptains: string[]) {
    try {
      logger.info(`${SOCKET_CLIENT_LOG_ID}: connectWithOtherCaptains`, otherCaptains)

      const clientSocketManagerPromises = []
      for (const eachCaptainUrl of otherCaptains) {
        clientSocketManagerPromises.push(
          SocketClientManager.createCaptainSocketClient(eachCaptainUrl)
            .then((socketClientManager: SocketClientManager) => {
              this.setClientSocketManagerForRemoteUrl(eachCaptainUrl, socketClientManager)
            })
            .catch((e: any) => {
              const error = new Error(
                `${SOCKET_CLIENT_LOG_ID}: error with connectAndRegisterListenerWithOtherCaptain: ${eachCaptainUrl}`,
                {cause: e}
              )
              logger.error(error)
              throw error
            })
        )
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
    if (this.raceHandler) {
      this.raceHandler.cleanUpForDeletion()
    }
    this.raceHandler = new CustomRaceConditionLock()
  }

  consulService!: ConsulService

  getConsulService() {
    return this.consulService
  }

  async registerConsulService() {
    this.consulService = await ConsulService.createConsulService()
  }

  notificationService!: NotificationService

  getNotificationService() {
    return this.notificationService
  }

  async registerNotificationService() {
    this.notificationService = await NotificationService.createNotificationService()
  }

  async resetAppState({
    resetSockets,
    resetWebApps,
    resetLockHandlers,
    resetLeaderShip,
  }: {
    resetSockets: boolean
    resetWebApps: boolean
    resetLockHandlers: boolean
    resetLeaderShip: boolean
  }) {
    this.cleanUpProcessedRemoteMessageTracker()    
    if (resetSockets) {
      // logger.info('softReloadApp:Step1:terminate socket server connections')
      await this.getSocketManager()?.cleanUpForDeletion()
      // logger.info('softReloadApp:Step2:terminate socket client connections')
      const remoteCaptains = Object.keys(this.getAllClientSocketManagers())
      for (const eachRemoteCaptainUrl of remoteCaptains) {
        // logger.info('softReloadApp:eachRemoteCaptainUrl', eachRemoteCaptainUrl)
        this.deleteClientSocketManagerByRemoteUrl(eachRemoteCaptainUrl)
      }
      await this.getMateSocketManager()?.cleanUpForDeletion()
    }
    if (resetWebApps) {
      // logger.info('softReloadApp:Step3:delete all webservices')
      const webServicesKeys = Object.keys(this.getWebServices())
      for (const eachServiceKey of webServicesKeys) {
        this.deleteWebService(eachServiceKey)
      }
    }
    if (resetLockHandlers) {
      this.getRaceHandler().cleanUpForDeletion()
    }
    // reset leadership data
    if (resetLeaderShip) {
      this.setLeaderUrl(undefined)
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
    return `ID/${appConfig.SELF_URL}/${messageType}/${++this.messageIDCounter}/${new Date().toISOString()}`
  }  
}

const appState = new AppState()

export default appState
