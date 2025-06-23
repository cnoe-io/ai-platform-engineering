# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openai_mcp_generator package

# Generated MCP Server

This is an automatically generated Model Context Protocol (MCP) server based on an OpenAPI specification.

## Prerequisites

- Python 3.8 or higher
- [Install Poetry](https://python-poetry.org/docs/#installation)
- Setup a virtual environment
```
poetry config virtualenvs.in-project true
poetry install
```


## Setup

1. Copy `.env.example` to `.env` and fill in your API credentials:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
poetry install
```

3. Run the server:

```bash
poetry run python -m server
```

## Available Tools

The following tools are available through the MCP server:


### PUT /pet
Update an existing pet.

Update an existing pet by Id.


### POST /pet
Add a new pet to the store.

Add a new pet to the store.


### GET /pet/findByStatus
Finds Pets by status.

Multiple status values can be provided with comma separated strings.


### GET /pet/findByTags
Finds Pets by tags.

Multiple tags can be provided with comma separated strings. Use tag1, tag2, tag3 for testing.


### GET /pet/{petId}
Find pet by ID.

Returns a single pet.


### POST /pet/{petId}
Updates a pet in the store with form data.

Updates a pet resource based on the form data.


### DELETE /pet/{petId}
Deletes a pet.

Delete a pet.


### POST /pet/{petId}/uploadImage
Uploads an image.

Upload image of the pet.


### GET /store/inventory
Returns pet inventories by status.

Returns a map of status codes to quantities.


### POST /store/order
Place an order for a pet.

Place a new order in the store.


### GET /store/order/{orderId}
Find purchase order by ID.

For valid response try integer IDs with value <= 5 or > 10. Other values will generate exceptions.


### DELETE /store/order/{orderId}
Delete purchase order by identifier.

For valid response try integer IDs with value < 1000. Anything above 1000 or non-integers will generate API errors.


### POST /user
Create user.

This can only be done by the logged in user.


### POST /user/createWithList
Creates list of users with given input array.

Creates list of users with given input array.


### GET /user/login
Logs user into the system.

Log into the system.


### GET /user/logout
Logs out current logged in user session.

Log user out of the system.


### GET /user/{username}
Get user by user name.

Get user detail based on username.


### PUT /user/{username}
Update user resource.

This can only be done by the logged in user.


### DELETE /user/{username}
Delete user resource.

This can only be done by the logged in user.

