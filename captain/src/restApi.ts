import {logger} from './coreUtils.js'
import appConfig from './appConfig.js'
import appState from './appState.js'
import {Application, NextFunction, Request, Response, Router, json} from 'express'

const router = Router()

router.get('/service/:service', json(), async (req, res) => {
  const serviceKey = req.params.service
  const serviceData = await appState.getWebService(serviceKey)?.getServiceDataForAPI()
  if (serviceData) {
    res.json(serviceData)
  } else {
    res.status(503).json({Message: `Service: "${serviceKey}" could not be found in the system`})
  }
})

router.get('/services', json(), async (req, res) => {
  const servicesPromise = Object.keys(appState.getWebServices()).map((eachKey) => {
    return appState.getWebService(eachKey)?.getServiceDataForAPI()
  })
  const services = await Promise.all(servicesPromise)
  res.json(services)
})

router.get('/status', json(), async (req, res) => {
  res.json({
    members: [...appConfig.MEMBER_URLS],
    leader: appState.getLeaderUrl(),
    services: Object.values(appState.getWebServices() || []).map((eachService) => eachService.serviceName)
  })
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
