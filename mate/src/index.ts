import express from 'express'
import {createServer} from 'http'
import {initializeAppModules, softReloadApp} from './coreUtils.js'

const shutdown = () => {
  console.info('Starting shutdown...')
  httpServer.close()
  console.info('Goodbye!')
  process.exit()
}
/* 
  Reload YAML on SIGHUP
  TODO
  a). check and remove state of services that is absent in the new file
  b). process any changes to existing file ?
*/
process.on('SIGHUP', function () {
  console.info('received SIGHUP')
  softReloadApp().catch((err) => {
    console.info('Reinitialization with processServiceFileYAML failed, exiting...')
    console.error('SIGHUP:failed', err)
    shutdown()
  })
})
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('unhandledRejection', (error, origin) => {
  console.error('unhandledRejection', origin, error)
  process.exit(1)
})
process.on('uncaughtException', (error, origin) => {
  console.error('uncaughtException', origin, error)
  process.exit(1)
})

const app = express()
const httpServer = createServer(app)
httpServer.listen(80, async function () {
  console.info(`App listening at:`, httpServer?.address?.())
  // logger.info('appConfig', {
  //   appConfig,
  // })
  try {
    await initializeAppModules()
  } catch (err) {
    console.info('Initialization failed, exiting...')
    console.error('Initialization:failed', err)
    shutdown()
  }
})
