import Joi from 'joi'

const appConfig: any = {}

export function processAppEnvironement() {
  const joiEnvSchema = Joi.object()
    .keys({
      NODE_ENV: Joi.string().valid('production', 'development', 'test').default('development'),
      DEBUG_MATE: Joi.boolean().description('DEBUG_MATE'),
      WEBSERVICE_YAML_LOCATION: Joi.string().description('WEBSERVICE_YAML_LOCATION').default('/data/services.yaml'),
      CAPTAIN_URL: Joi.string()
        .required()
        .custom((value) => {
          // convert comma separated list of CAPTAIN_URL to array lists
          const captainsArray = `${value}`.split(',').map((eachAddress) => `${eachAddress}`.trim())
          return captainsArray
        })
        .description('CAPTAIN_URL'),
      CAPTAIN_SECRET_KEY: Joi.string().required().description('CAPTAIN_SECRET_KEY'),
      MATE_ID: Joi.string().description('MATE_ID'),
      KEEP_ALIVE: Joi.number().description('KEEP_ALIVE').default(120),
      INTERVAL: Joi.number().description('INTERVAL').default(5),
      DEFAULT_CONNECT_TIMEOUT: Joi.number().description('DEFAULT_CONNECT_TIMEOUT').default(2),
      DEFAULT_READ_TIMEOUT: Joi.number().description('DEFAULT_READ_TIMEOUT').default(2),
    })
    .options({stripUnknown: true, abortEarly: false})

  const {value: envVars, error} = joiEnvSchema.validate(process.env)

  if (error) {
    console.error(`Error with environment variable(s): ${error?.message || error}`)
    process.exit(1)
  }
  Object.assign(appConfig, {
    ...envVars,
  })
  // console.info('appConfig:', appConfig)
}

processAppEnvironement()

export default appConfig
