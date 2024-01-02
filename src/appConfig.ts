import {logger} from './coreUtils.js'
import Joi from 'joi'

logger.info('appConfig', process.env)
const joiEnvSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid('production', 'development', 'test').default('development'),
    DEBUG: Joi.string().custom((value) => {
      // setting DEBUG=captain will enable debug mode
      if (
        `${value}`
          .split(',')
          .map((eachValue) => `${eachValue}`.trim())
          .includes('captain')
      ) {
        return true
      } else {
        return false
      }
    }),
    DEFAULT_HEALTHY_INTERVAL: Joi.number().description('DEFAULT_HEALTHY_INTERVAL').default(15),
    DEFAULT_UNHEALTHY_INTERVAL: Joi.number().description('DEFAULT_UNHEALTHY_INTERVAL').default(60),
    DEFAULT_FALL: Joi.number().description('DEFAULT_FALL').default(2),
    DEFAULT_RISE: Joi.number().description('DEFAULT_RISE').default(2),
    DEFAULT_CONNECT_TIMEOUT: Joi.number().description('DEFAULT_CONNECT_TIMEOUT').default(2),
    DEFAULT_READ_TIMEOUT: Joi.number().description('DEFAULT_READ_TIMEOUT').default(2),
    DEFAULT_COOL_DOWN: Joi.number().description('DEFAULT_COOL_DOWN').default(240),
    MEMBER_URLS: Joi.string()
      .required()
      .custom((value) => {
        // convert comma separated list of MEMBERS to array lists
        const membersArray = `${value}`.split(',').map((eachAddress) => `${eachAddress}`.trim())
        return membersArray
      })
      .description('MEMBER_URLS'),
    SELF_URL: Joi.string().required().description('SELF_URL'),
    CAPTAIN_PORT: Joi.number().description('CAPTAIN_PORT').default(7400),
    CAPTAIN_SECRET_KEY: Joi.string().required().description('CAPTAIN_SECRET_KEY'),
    DNS_PROVIDER: Joi.string()
      .description('DNS_PROVIDER')
      .default('cloudflare')
      .valid(...['cloudflare', 'technitium']),
    CLOUDFLARE_TOKEN: Joi.string().description('CLOUDFLARE_TOKEN'),
    CLOUDFLARE_ZONE_ID: Joi.string().description('CLOUDFLARE_ZONE_ID'),
  })
  .custom((obj, helpers) => {
    const {MEMBER_URLS, SELF_URL} = obj
    if (!MEMBER_URLS?.includes(SELF_URL)) {
      return helpers.message(`SELF_URL(${SELF_URL}) needs to be part of MEMBER_URLS(${MEMBER_URLS})` as any)
    }
    return obj
  })
  .options({stripUnknown: true, abortEarly: false})

const {value: envVars, error} = joiEnvSchema.validate(process.env)

if (error) {
  logger.error(`Error with environment variable(s): ${error?.message || error}`)
  process.exit(1)
}

const appConfig = {
  ...envVars,
  API_PREFIX: '/v1',
}

export default appConfig
