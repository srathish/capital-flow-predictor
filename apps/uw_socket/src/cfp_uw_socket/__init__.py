"""WebSocket subscriber for Unusual Whales real-time channels.

Long-running async service. Holds 5 WebSocket connections + 1 periodic
news poller and writes events to Postgres for the Pulse tape and the
Explosive Board.

Entry point: ``python -m cfp_uw_socket.main``
"""
