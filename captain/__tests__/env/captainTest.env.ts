process.env.MEMBER_URLS = 'ws://127.0.0.1:7401,ws://127.0.0.1:7402,ws://127.0.0.1:7403'
process.env.SELF_URL = 'ws://127.0.0.1:7401'
process.env.CAPTAIN_PORT = '7401'
process.env.CAPTAIN_SECRET_KEY = 'erwoc2q34m23nlfWS69ri'
process.env.DNS_PROVIDER = 'technitium'
process.env.TECHNITIUM_BASE_URL = 'http://10.6.0.2:5380'
process.env.TECHNITIUM_CUSTOM_ZONE_NAME = 'ops'
process.env.WEBSERVICE_YAML_LOCATION = './__tests__/data/captain-one-services.yaml'
process.env.MATE_PORT='7450'
process.env.MATE_SECRET_KEY='ksjdhf2q34m23nlfWS69ri'

// mate specific properties
process.env.__MATE_COMMON__CAPTAIN_URL='ws://127.0.0.1:7450'
process.env.__MATE_COMMON__CAPTAIN_SECRET_KEY='ksjdhf2q34m23nlfWS69ri'

process.env.__MATE_TEST_1__WEBSERVICE_YAML_LOCATION = './__tests__/data/mate-1-services.yaml'
process.env.__MATE_TEST_2__WEBSERVICE_YAML_LOCATION = './__tests__/data/mate-2-services.yaml'

