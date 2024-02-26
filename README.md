# Captain

This Node.js app ("Captain") acts as a public DNS failover orchestrator. It monitors health of services and updates
DNS records according to the health of each upstream address. It can run stand-alone or be accompanied by any
number of "Mates" which are used to report remote services and perform remote health checks on those services.

Multiple instances of Captain may run simultaneously, each one will be used to run health checks. One instance is
designated as the leader either by configuration (non-HA) or by checking against a local Consul agent's "leader"
API endpoint (HA).

In order to perform a failover, the leader must receive an agreement between all instances as to which addresses
are "up". More than one address may be "up", in which case all addresses will be included if "multi" is true,
otherwise the current DNS record value will be preferred. If multiple are "up" but none are in the current DNS record,
then the "first" one (sorted lexicographically) will be preferred and the DNS record updated with this one address.

# Static Services

Static services may be defined through a `services.yaml` file loaded by Captain at startup. This file will be re-read
upon receiving a `SIGHUP` signal so services can be added, updated and removed without restarting the process.
These services will be health-checked directly by the Captain members to detect a demand for failover.

# Service Discovery

Another app called "Mate" will connect to the Captain websocket and announce any local services that should be
monitored. The Captain instance will either forward this info to the leader instance if it is a follower, or
announce the new services to all the follower instances if it is the leader so that all members have the same state.

The Mate instances report services from the Mate's `services.yaml` file which is also re-read upon receiving a
`SIGHUP` signal. These services will be health-checked *by the Mate* and their status will be reported to the
Captain members via the websocket messages. This allows the Mate to operate efficiently with a large number of
services on the private network behind a load balancer.

When a Mate disconnects, this is also reported to the other Captains. If there are no more Mates reporting for a
service (it is "orphaned"), the Captain will start performing its own health checks on the services as if they were
locally-defined services. The Captain will remove any "orphaned" services from internal bookkeeping after 12 hours.

When a Mate reconnects, it will re-report its services as if it had just been started and the services present will
no longer be orphaned.

# Configuration

A Captain instance has the following configuration environment variables:

| Name                         | Description                                                                                                                                                              | Default      |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| `DEFAULT_HEALTHY_INTERVAL`   | The number of seconds between checks to a healthy address                                                                                                                | 15           |
| `DEFAULT_UNHEALTHY_INTERVAL` | The number of seconds between checks to an unhealthy address                                                                                                             | 60           |
| `DEFAULT_FALL`               | The number of failing checks to confirm "down"                                                                                                                           | 2            |
| `DEFAULT_RISE`               | The number of passing checks to confirm "up"                                                                                                                             | 2            |
| `DEFAULT_CONNECT_TIMEOUT`    | The number of seconds before connection times out                                                                                                                        | 2            |
| `DEFAULT_READ_TIMEOUT`       | The number of seconds to wait for response                                                                                                                               | 2            |
| `DEFAULT_COOL_DOWN`          | The number of seconds to wait between failovers                                                                                                                          | 240          |
| `MEMBER_URLS`                | A JSON array of member websocket urls                                                                                                                                    |              |
| `SELF_URL`                   | The url of this server instance (matching one of the `MEMBER_URLS`)                                                                                                      |              |
| `CONSUL_HTTP_*`              | Multiple variables used to connect to Consul - see [Consul-related Variables](https://developer.hashicorp.com/nomad/docs/runtime/interpolation#consul-related-variables) |              |
| `CONSUL_LEADER_INTERVAL`     | The interval in seconds between checks of the Consul leader                                                                                                              | 5            |
| `CAPTAIN_PORT`               | The port to listen on for other Captain instances (unauthenticated)                                                                                                      |              |
| `CAPTAIN_SECRET_KEY`         | The secret key to authenticate Captain instances with                                                                                                                    |              |
| `MATE_PORT`                  | The port to listen on for Mate instances                                                                                                                                 |              |
| `MATE_SECRET_KEY`            | The secret key to authenticate Mate instances with                                                                                                                       |              |
| `DNS_PROVIDER`               | The DNS provider                                                                                                                                                         | cloudflare   |
| `CLOUDFLARE_TOKEN`           | The Cloudflare API token                                                                                                                                                 |              |
| `CLOUDFLARE_ZONE_ID`         | The Cloudflare Zone ID where records will be updated                                                                                                                     |              |
| `SLACK_TOKEN`                | The API token for sending Slack notifications                                                                                                                            |              |
| `SLACK_CHANNEL_ID`           | The Slack channel ID for sending Slack notifications                                                                                                                     |              |
| `DATADOG_SITE`            | There are several Datadog sites available worldwide, we need to specify which one                                                                                                                               |              |
| `DATADOG_API_KEY`            | The API key for logging events to Datadog                                                                                                                                |              |
| `NOTIFICATION_URL`           | The url to post HTTP notifications to                                                                                                                                    |              |
| `NOTIFICATION_HEADER`        | A header to include in the HTTP notification requests                                                                                                                    |              |

A Mate instance has the following configuration environment variables:

| Name          | Description                                                                   | Default |
|---------------|-------------------------------------------------------------------------------|---------|
| `CAPTAIN_URL` | The websocket url of the Captain service                                      |         |
| `MATE_ID`     | The unique ID of the mate instance                                            |         |
| `KEEP_ALIVE`  | The number of seconds to keep connections to the health check endpoints alive | 90      |
| `INTERVAL`    | The number of seconds between local health checks                             | 5       |

# Services Data

Services can be described in the following formats:

```yaml
---
- name: captain
  description: I am the captain now!
  tags:
    - platform
  zone_record: captain.ops
  addresses:
    - 215.215.215.215
    - 34.34.34.34
    - 100.100.100.100
  multi: true
  check:
    protocol: https
    host: captain.example.com # might be a CNAME to the service record
    port: 443
    path: /ping
  unhealthy_interval: 120
  healthy_interval: 5
  fall: 3
  rise: 3
  connect_timeout: 3
  read_timeout: 3
  cool_down: 300
```

| Field              | Description                                                       | Default |
|--------------------|-------------------------------------------------------------------|---------|
| name               | A unique human-readable identifier for this service               |         |
| description        | A description just for context                                    |         |
| tags               | A list of tags for this service                                   |         |
| zone_record        | A DNS record to manage for this service                           |         |
| addresses          | A list of public IP addresses to check health for this service    |         |
| multi              | True if this service supports multiple IP addresses (distributed) |         |
| check              | Details for how to perform the health check                       |         |
| check.protocol     | The protocol to use                                               | https   |
| check.host         | The value to use for the Host header                              | null    |
| check.port         | The port to use for the connection                                | 443     |
| check.path         | The path to use for the request                                   |         |
| unhealthy_interval | The optional override for the default value of the same name      |         |
| healthy_interval   | The optional override for the default value of the same name      |         |
| fall               | The optional override for the default value of the same name      |         |
| rise               | The optional override for the default value of the same name      |         |
| connect_timeout    | The optional override for the default value of the same name      |         |
| read_timeout       | The optional override for the default value of the same name      |         |
| cool_down          | The optional override for the default value of the same name      |         |

Services for Mates have an additional `mate` property because the Mate will perform the constant health
checks instead of the Captain. The `check` will only be performed by the Captain just before failover occurs and the
constant monitoring health checks are performed only by the Mate using the addresses defined in the `mate.addresses`
field. These are always assumed to be `http` only.

```yaml
---
- name: app-acme-inc
  description: Web app for ACME, Inc.
  tags:
    - app
  zone_record: acme-inc
  addresses:
    - 215.215.215.215
  multi: false
  check:
    path: /ping
  mate:
    addresses:
      - 10.10.0.2:23382
    path: /ping
```

There may be multiple service addresses for the `mate` check and the service will only be reported to the Captain
as "down" when the number of "up" addresses reaches zero. As the number of addresses could be very high and in a
primary-secondary scenario all of them could be "down" 99.9% of the time, the addresses are checked using a round-robin
algorithm at the `INTERVAL` rate until a check results in a possible new state (transition). For example, if the
current state is "down" then the normal interval is used as long as each check is also "down". When a check results
in an unexpected state, up to five or 50% (whichever is lower) of additional addresses will be checked immediately
to confirm the new state. If these immediate checks do not agree on the new state the state transition fails, and it
resumes the normal check interval.

## Mate Reports

The data the Mate reports to the Captain on connect and reconnect is the list of services excluding  the `mate`
property. These services are added to the Captain's list of services with `is_remote = true` so that the Captain
members do not continually perform health checks on them. However, the Captain members *do* perform health checks
*until* the rise or fall values are reached.

```json
{
  "version": "1.0",
  "mate_id": "a1b2c3",
  "services": [ { "...":  "..." }]
}
```

Then, the Mate only reports to a Captain when a service status changes with a payload like so:

```json
{
  "version": "1.0",
  "mate_id": "a1b2c3",
  "service": "app-acme-inc",
  "upstreams": 1,
  "healthy": 1
}
```

The `healthy` count being greater than zero indicates an "up" state even if it is less than the `upstreams` count.
It just indicates how many checks were used to confirm the "up" state. The `healthy` count being zero indicates a
"down" state.

Upon receiving this message, the Captain will then reset the check values for the service addresses so that normal
health checks will resume and a failover may occur if needed once the rise or fall values are reached for the service.

# High Availability

When run in "cluster" mode, multiple instances of Captain communicate with each other over websockets (socket.io).
If a Consul cluster is configured it is assumed that one instance of Captain runs on each machine that runs one Consul
agent, and therefore the Consul "leader" can be used to determine a Captain "leader" just based on which Captain
instance is running on the same node as the Consul leader. This design decision is just intended to avoid dealing with
real leader election and network chatter and instead piggyback off of Consul's leader election.

If Consul configuration is not provided, the leader with the first-sorted `SELF_URL` is always the leader. This does
not provide high availability, but it does allow you to have multiple members performing the same health checks
which is important to avoid false failovers. If the leader member was down, the other members would not take its place.

Therefore, each Captain instance in a HA cluster has for configuration:

- A list of all members' websocket urls
- The "self" websocket url (must match one of the values in the list of members)
- The API base url of the Consul agent running on the same node (required for true leader election)

Each member will contact the local Consul agent to discover its peer address using the [Read Configuration](https://developer.hashicorp.com/consul/api-docs/agent#read-configuration)
endpoint (`{.Member.Addr}:{.Member.Port}`). It will then check every 30 seconds to see if it is running on the same
node as the Consul leader and if so, promote itself to the leader, and otherwise remain a follower.

Each time a Captain leader generates a failover condition, it will immediately confirm if it is a leader or a follower
before taking any action as a leader. Unless a leader change happens at the same exact time as a failover condition,
this is intended to sufficiently ensure that exactly one Captain member acts as the leader. 

## Captain Member Gossip

All Captain members maintain full state so that being "leader" only matters if there is a need for failover.
The member-to-member gossip includes the following messages.

### New leader

Broadcast to followers when a member deems itself the leader. If the recipient thinks it is the leader, this triggers
an immediate update to check to see if it is still the leader according to Consul. Each member tracks the leader so
that it can be reported via the REST API if needed, but otherwise this has no effect. No message is sent when a leader
becomes a follower.

```json
{
  "new": "ws://127.0.0.1:7400", 
  "old": "ws://127.0.0.1:7401"
}
```

### New remote services

New services discovered by a connected Mate (just a copy of the payload received from the Mate) report the service
information immediately upon connection and these services must be communicated to the other Captains so each has the
full data for all services.

Multiple such messages are also sent when a new captain 'peer' joins the network so as to update the new captain about the state of existing remote web services. Messages derived from state rather than storing all previously received messages.

```json
{
  "message_id": "unique_id",
  "mate_id": "a1b2c3",
  "services": [ { "...":  "..." }]
}
```

### Disconnected remote services

Similarly, a Mate disconnecting is reported to the other Captains as well. 

Multiple such messages are also sent when a new captain 'peer' joins the network so as to update the new captain about all the previous disconnection messages of 'mates'. Message derived from state (is_orphan) rather than storing all previously received messages.

```json
{
  "message_id": "unique_id",
  "mate_id": "a1b2c3",
  "services": [ { "...":  "..." }]
}
```

### Health check request

When a leader detects an unhealthy state, or when any member receives a health status change from a Mate, it tells the
other members to perform a health check by resetting their counters if they are greater than or equal to the rise or
fall values. The members will then start emitting the health check update described in the next subsection.

```json
{
  "service": "captain",
  "address": "34.34.34.34",
  "verifyState": "passing"
}
```

The "verifyState" can be either "passing" or "failing". It helps decide, whether to reset an ongoing health check ( that has not reached rise/fall yet ), if there is a change in the health of an "address" from "passing" to "failing" or "failing" to "passing".

The "verifyState" is optional and in its absense, health check will be reset, irrespective of the current state ( 'passing' or 'failing')

Additionally, a health check request for each service that is provided by a Mate is sent to the other members when
the Mate disconnects from a Captain unexpectedly. This ensures that if the node the Mate is running on goes offline,
the health check failure will not go undetected.

### Health check updates

A health check update reports the consecutive passing and failing counts for a single IP address of a single service.
Not every health check is reported, only in the following cases:

- Failed health checks for a service are reported until `failing` exceeds the "fall" value.
- Successful health checks for a service are reported until `passing` exceeds the "rise" value.
- The last known health check state for each service is reported (as separate messages) when a new Captain is discovered.

```json
{
  "member": "ws://127.0.0.1:7401",
  "service": "captain",
  "address": "215.215.215.215",
  "failing": 2,
  "passing": 0
}
```

The Captain members upon receiving this update will merge it into their local state data.

#### Notes

The `failing` and `passing` values are *consecutive* numbers, so only one can ever be positive since you cannot
have both at once. A follower that reports a failure continues to run checks at the normal interval but only broadcast
the status messages until the rise or fall value is exceeded to avoid needless chatter.

It is assumed that the services provided by the member config file is already synchronized across all members. Any
health check updates received for services that are not recognized are logged as unrecognized service names and then
ignored. 

### Bulk health check updates

The bulk health check update reports the consecutive passing and failing counts for all IP addresses of all the services currently being tracked.

It is used only when a new captain peer joins the network. Helps in efficiently transferring data to the newly discovered captain.

The message format is an array of the normal "Health check updates" described above.

### Active addresses

When a leader updates the active addresses for a service, it propagates the new values to the other members so that
they have the correct state.

```json
{
  "service": "captain",
  "addresses": [
    "215.215.215.215"
  ]
}
```

### Bulk active addresses

This message reports the current active addresses of all the services being tracked.

It is used only when a new captain peer joins the network. Helps in efficiently transferring data to the newly discovered captain.

The message format is an array of the normal "Active addresses" message described above.

### Change polling frequency

Only the leader maintains the web service "status" ("healthy" OR "unhealthy").

Since the polling need to use "healthy_interval" or "unhealthy_interval" based on health "status" of the service, leader communicates the polling frequency required via this message "broadcast" to non-leader members

# State Management

The in-memory state thus contains the config data structure for each known service and additional fields regarding
the current state like so:

```json
{
  "captain": {
    "service": {
      "name": "captain",
      "...": "..."
    },
    "is_remote": false,
    "is_orphan": false,
    "mates": [],
    "checks": {
      "ws://127.0.0.1:7400": {
        "215.215.215.215": {
          "failing": 1,
          "passing": 0,
          "last_update": "..."
        },
        "34.34.34.34": { "...": "..." }
      },
      "ws://127.0.0.1:7401": { "...": "..." },
      "ws://127.0.0.1:7402": { "...": "..." }
    },
    "active": [
      "215.215.215.215"
    ],
    "status": "unhealthy",
    "failover": null,
    "failover_started": "{Date object}",
    "failover_finished": "{Date object}"
  }
}
```

Only the leader maintains the `status`, `failover`, `failover_started`, and `failover_finished` properties and only
leader updates the `active` property with an API request to the DNS provider.

When a member discovers that it is the leader (including on startup) it immediately updates the `active` addresses
for the service's `zone_record` property value from the Cloudflare API and resets the `checks` counters for itself
to zero to ensure that reaching the "fall" value of failures will trigger a failing condition in the future. Thus,
the initial `status` for all services is assumed to be `"healthy"`. 

# Failover

A failover is handled only by the Captain leader and consists of the following steps:

- Update the `zone_record` values via the DNS provider API and send the 'Active addresses' message to the followers 
- Reset health check counters and broadcast a 'Health check request' message to followers
  - Wait for the "cool_down" seconds after the failover update, if the status for the service is not `"healthy"` then
    log a message that the failover failed and send a Slack message and generic HTTP POST.
- Send notifications to the configured notification endpoints.

Any unrecognized IP addresses will be removed unless it is the last IP address. In this way, distributed services that
utilize round-robin DNS can be managed efficiently but a service that is completely down will still have a DNS record.

If the time since the last failover was less than the `cool_down`, then the failover will be skipped and after the
remaining time before cool down ends has elapsed, the check counters will be reset and a 'Health check request' message
will be sent to the followers to start a fresh cycle.

# Notifications

Notifications are sent any time an attempt is made to make a DNS update whether it fails or succeeds.

## Slack

A Slack message will be sent to your channel of choice using `chat.postMessage` REST API.

```markdown
# DNS failover {succeeded|failed}

**{description}**

Captain {attempted to update|updated} the DNS record for {zone_record}.
- Added: {added}
- Removed: {removed}

{error_message}
```

## Datadog

A Datadog event will be posted using the Datadog `/api/v1/events` REST API.

- Title: "DNS failover"
- Text: DNS record for {description} ({zone_record}) updated. Added: {added}, Removed: {removed}
- Text: DNS record update failed for {description} ({zone_record}). Added: {added}, Removed: {removed}, Error: {error_message}
- Alert type: `"user_update"`
- Tags: `"captain"` plus the service's `tags` property

## Generic HTTP

A JSON object will be sent to your HTTP endpoint.

```json
{
  "status": "success",
  "name": "acme-inc",
  "description": "...",
  "tags": ["web"],
  "zone_record": "acme-inc",
  "added": ["47.47.47.47"],
  "removed": ["217.217.217.217"],
  "error_message": ""
}
```

# REST API

Each Captain member exposes a REST API. Authentication is assumed to be handled externally by a proxy.

## GET /v1/service/{service}

Returns the details of a service and its current state.

- The `resolved_addresses` is determined by a live DNS query to the `check_hostname` using the `9.9.9.9` resolver.
  The `check_hostname` is assumed to be either a `CNAME` record pointing to the `zone_record` or the zone record itself. 
- The `checks` values are computed dynamically based on the check status of each of the advertised service addresses so
  the sum of `failing` and `passing` should equal the number of Captain members.
- The `status` is determined as follows:
  - If the `resolved_addresses` matches exactly the set of `active_addresses` and the service addresses that have
    `passing` greater than zero, it is considered `"healthy"`.
  - If the `resolved_addresses` does not match the set of `active_addresses` and the `active_addresses` matches the
    service addresses that have `passing` greater than zero, it is considered `"updating"`.
  - Otherwise, it is considered `"unhealthy"`.

```json
{
  "name": "captain",
  "description": "I am the captain now!",
  "tags": [
    "platform"
  ],
  "zone_record": "captain.ops",
  "check_protocol": "https",
  "check_hostname": "captain.example.com",
  "resolved_addresses": [
    "215.215.215.215"
  ],
  "active_addresses": [
    "215.215.215.215"
  ],
  "checks": {
    "215.215.215.215": {
      "failing": 2,
      "passing": 1,
      "last_update": "..."
    },
    "34.34.34.34": {
      "...": "..."
    }
  },
  "status": "healthy"
}
```

## GET /v1/services

Returns the details of all registered services (as above but wrapped in an array).

```json
[
  {
    "name": "captain",
    "...": "..."
  }
]
```

## GET /v1/status

Return the status of the Captain cluster

```json
{
  "members": [
    "ws://127.0.0.1:7400",
    "ws://127.0.0.1:7401",
    "ws://127.0.0.1:7402"
  ],
  "leader": "ws://127.0.0.1:7400",
  "services": [
    "captain"
  ]
}
```
