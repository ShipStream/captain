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
  // console.info('appConfig:process.env', process.env)
  const joiEnvSchema = Joi.object()
    .keys({
      NODE_ENV: Joi.string().valid('production', 'development', 'test').default('development'),
      // setting DEBUG=captain will enable debug mode
      // debug can be a comma separated list of modules ('captain' being one among them)
      // eg: DEBUG=mate,captain
      DEBUG: Joi.string().custom((value) => {
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
      WEBSERVICE_YAML_LOCATION: Joi.string().description('WEBSERVICE_YAML_LOCATION').default('/data/services.yaml'),
      DEFAULT_HEALTHY_INTERVAL: customJoi.customNumber().description('DEFAULT_HEALTHY_INTERVAL').default(15),
      DEFAULT_UNHEALTHY_INTERVAL: customJoi.customNumber().description('DEFAULT_UNHEALTHY_INTERVAL').default(60),
      DEFAULT_FALL: customJoi.customNumber().description('DEFAULT_FALL').default(2),
      DEFAULT_RISE: customJoi.customNumber().description('DEFAULT_RISE').default(2),
      DEFAULT_CONNECT_TIMEOUT: customJoi.customNumber().description('DEFAULT_CONNECT_TIMEOUT').default(2),
      DEFAULT_READ_TIMEOUT: customJoi.customNumber().description('DEFAULT_READ_TIMEOUT').default(2),
      DEFAULT_COOL_DOWN: customJoi.customNumber().description('DEFAULT_COOL_DOWN').default(240),
      MEMBER_URLS: Joi.string()
        .required()
        .custom((value) => {
          // convert comma separated list of MEMBERS to array lists
          const membersArray = `${value}`.split(',').map((eachAddress) => `${eachAddress}`.trim())
          return membersArray
        })
        .description('MEMBER_URLS'),
      SELF_URL: Joi.string().required().description('SELF_URL'),
      CAPTAIN_PORT: customJoi.customNumber().description('CAPTAIN_PORT').default(7400),
      CAPTAIN_SECRET_KEY: Joi.string().required().description('CAPTAIN_SECRET_KEY'),
      MATE_PORT: customJoi.customNumber().description('MATE_PORT').default(7450),
      MATE_SECRET_KEY: Joi.string().required().description('MATE_SECRET_KEY'),
      CONSUL_HTTP_ADDR: customJoi.customOptionalStr().description('CONSUL_HTTP_ADDR'),
      CONSUL_HTTP_TOKEN: customJoi.customOptionalStr().description('CONSUL_HTTP_TOKEN'),
      CONSUL_LEADER_INTERVAL: customJoi.customNumber().description('CONSUL_LEADER_INTERVAL').default(5),
      SLACK_TOKEN: customJoi.customOptionalStr().description('SLACK_TOKEN'),
      SLACK_CHANNEL_ID: customJoi.customOptionalStr().description('SLACK_CHANNEL_ID'),
      DATADOG_SITE: customJoi.customOptionalStr().description('DATADOG_SITE'),
      DATADOG_API_KEY: customJoi.customOptionalStr().description('DATADOG_API_KEY'),
      NOTIFICATION_URL: customJoi.customOptionalStr().description('NOTIFICATION_URL'),
      NOTIFICATION_HEADER: customJoi.customOptionalStr().description('NOTIFICATION_HEADER'),
      DNS_PROVIDER: customJoi.customOptionalStr()
        .description('DNS_PROVIDER')
        .default('cloudflare')
        .valid(...['cloudflare', 'technitium']),
      CLOUDFLARE_TOKEN: Joi.when('DNS_PROVIDER', {
        is: 'cloudflare', then: Joi.string().required(), otherwise: customJoi.customOptionalStr()
      }).description('CLOUDFLARE_TOKEN'),
      CLOUDFLARE_ZONE_ID: Joi.when('DNS_PROVIDER', {
        is: 'cloudflare', then: Joi.string().required(), otherwise: customJoi.customOptionalStr()
      }).description('CLOUDFLARE_ZONE_ID'),
      TECHNITIUM_BASE_URL: Joi.when('DNS_PROVIDER', {
        is: 'technitium', then: Joi.string().required(), otherwise: customJoi.customOptionalStr()
      }).description('TECHNITIUM_BASE_URL'),
      TECHNITIUM_CUSTOM_ZONE_NAME: Joi.when('DNS_PROVIDER', {
        is: 'technitium', then: Joi.string().required(), otherwise: customJoi.customOptionalStr()
      }).description('TECHNITIUM_CUSTOM_ZONE_NAME')
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
    console.error(`Error with environment variable(s): ${error?.message || error}`)
    process.exit(1)
  }
  Object.assign(appConfig, {
    ...envVars,
    SLACK_BASE_URL: 'https://slack.com/api',
    API_PREFIX: '/v1',
  })
  // console.info('appConfig:', appConfig)
}

processAppEnvironement()

export default appConfig
