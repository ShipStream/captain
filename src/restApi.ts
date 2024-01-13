import {logger} from './coreUtils.js'
import appConfig from './appConfig.js'
import appState from './appState.js'
import {Application, NextFunction, Request, Response, Router, json} from 'express'

const router = Router()

router.get('/services', json(), async (req, res) => {
  const services = Object.keys(appState.webServices).map((eachKey) => {
    return appState.webServices[eachKey]?.getServiceDataForReporting()
  })
  res.json(services)
})

export async function setupExpress(app: Application) {
  app.get('/ping', (_req, res) => {
    res.send('pong')
  })

  // Declare all core routes
  app.use(appConfig.API_PREFIX || '/', router)

  // After all routes are declared, declare error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const statusCode = 504
    const response = {
      statusCode,
      message: err?.message || 'Unknown Error',
      ...(appConfig.NODE_ENV === 'development' ? {stack: err.stack} : {}),
    }
    logger.error(err)
    res.status(statusCode).send(response)
  })
}
