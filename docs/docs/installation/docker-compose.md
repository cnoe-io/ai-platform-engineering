## Docker Compose

This script is designed to set up and manage a multi-container application environment using Docker Compose. It provides the following functionality:

1. **Environment Setup**: Ensure Docker and Docker Compose are installed on your machine.
2. **Service Configuration**: Define the required services in a `docker-compose.yml` file.
3. **Start Services**: Use the `docker-compose up -d` command to initialize and run the services in detached mode.
4. **Service Verification**: Check the status of running services using `docker-compose ps`.

Follow these steps to deploy and manage your application efficiently.

1. Install Docker and Docker Compose on your machine.
2. Create a `docker-compose.yml` file with the required services.
3. Run the following command to start the services:
  ```bash
  docker-compose --profile=p2p up
  ```
1. Verify the services are running:
  ```bash
  docker-compose ps
  ```
