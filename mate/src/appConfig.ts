import Joi from 'joi'

const appConfig: any = {}

// Extend joi to modify the 'number'/'string' type to accept empty string and treat it (coerce/transform) as undefined.
// Needed for docker compose, because, in case of absense of value, docker compose sends empty string instead of not sending any value at all ( undefined ).
// This behaviour causes issue with 'type' and 'defaultValue' as 'Joi' intreprets empty string as wrong value instead of absense of value.
// Treating empty string as undefined solves the issue.
const customJoi = Joi.extend(...[(joi: any) => {
  return {
    type: 'customNumber',
    base: Joi.number(),
    coerce(value: any, helpers: any) {
      if (value === '') {
        return { value: undefined };
      }
      return { value };
    },
  }
}, (joi: any) => {
  return {
    type: 'customOptionalStr',
    base: Joi.string().optional(),
    coerce(value: any, helpers: any) {
      if (value === '') {
        return { value: undefined };
      }
      return { value };
    },
  }
}])

export function processAppEnvironement() {
  const joiEnvSchema = Joi.object()
    .keys({
      NODE_ENV: Joi.string().valid('production', 'development', 'test').default('development'),
      // setting DEBUG=mate will enable debug mode
      // debug can be a comma separated list of modules ('mate' being one among them)
      // eg: DEBUG=mate,captain
      DEBUG: Joi.string().custom((value) => {
        if (
          `${value}`
            .split(',')
            .map((eachValue) => `${eachValue}`.trim())
            .includes('mate')
        ) {
          return true
        } else {
          return false
        }
      }),
      WEBSERVICE_YAML_LOCATION: Joi.string().description('WEBSERVICE_YAML_LOCATION').default('/data/services.yaml'),
      CAPTAIN_URL: Joi.string()
        .required()
        .custom((value) => {
          // convert comma separated list of CAPTAIN_URL to array lists
          const captainsArray = `${value}`.split(',').map((eachAddress) => `${eachAddress}`.trim())
          return captainsArray
        })
        .description('CAPTAIN_URL'),
      MATE_SECRET_KEY: Joi.string().required().description('MATE_SECRET_KEY'),
      MATE_ID: Joi.string().required().description('MATE_ID'),
      KEEP_ALIVE: customJoi.customNumber().description('KEEP_ALIVE').default(120),
      INTERVAL: customJoi.customNumber().description('INTERVAL').default(5),
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
