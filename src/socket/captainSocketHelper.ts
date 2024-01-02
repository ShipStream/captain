export const EVENT_NAMES = {
  NEW_LEADER: 'new-leader',
  ACTIVE_ADDRESSES: 'active-addresses',
  BULK_ACTIVE_ADDRESSES: 'complete-active-addresses', //  array of 'ACTIVE_ADDRESSES' as payLoad
  HEALTH_CHECK_REQUEST: 'health-check-request',
  RESET_POLLING_REQUEST: 'reset-polling-request',
  HEALTH_CHECK_UPDATE: 'health-check-update',
  BULK_HEALTH_CHECK_UPDATE: 'complete-health-check-update', // array of 'HEALTH_CHECK_UPDATE' as payLoad
}

export const SOCKET_SERVER_LOG_ID = 'CAPTAIN-SOCKET-SERVER'

export const SOCKET_CLIENT_LOG_ID = 'CAPTAIN-SOCKET-CLIENT'
