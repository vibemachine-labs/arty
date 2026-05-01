# MCP OAuth Authentication Plan

## Overview

Implement OAuth 2.0 authentication for MCP server connections following the MCP authorization spec with PKCE and dynamic client registration.

## Steps

### Step 1 — Fetch MCP Server Metadata

Connect to the MCP server and fetch the root metadata to discover the `resource_metadata_url`.

### Step 2 — Fetch Resource Metadata

Fetch `resource_metadata_url` to retrieve the `authorization_servers` list.

### Step 3 — Probe OAuth Authorization Server

Send a request to `/.well-known/oauth-authorization-server` on the auth server to discover:
- `authorization_endpoint`
- `token_endpoint`
- `registration_endpoint`

### Step 4 — Dynamic Client Registration

POST to `registration_endpoint` to dynamically register the client and receive a `client_id`.

### Step 5 — Open In-App Browser for Authorization

Open an in-app browser to `authorization_endpoint` with:
- PKCE `code_challenge`
- `resource` param

### Step 6 — Exchange Code for Token

Handle the redirect callback, then POST to `token_endpoint` with:
- `code`
- `code_verifier`

Store the resulting access token securely.
