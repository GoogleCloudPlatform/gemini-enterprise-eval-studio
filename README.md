# Gemini Enterprise Eval Studio

## Overview

Gemini Enterprise Eval Studio is an evaluation framework designed to execute
stateless API calls against Gemini Enterprise for E2E evaluation.
It enables customers to run batch evaluations, compare baselines, measure
streaming latency metrics (TTFT, TFUFT, Grounding Latency, Tool Execution
Latency), and define custom metrics using auto-grader rubrics or programmatic
evaluators.

## Motivation

Quality assurance is a major friction point for Gemini Enterprise
implementations. Enterprise customers require secure, client-side tools to
evaluate model performance, accuracy, and streaming latency on custom
collections without relying on externally hosted evaluation platforms that
violate data privacy policies.

## Key Features

-   **Client-Side Stateless Execution**: Direct API communication using end-user
    tokens, ensuring data privacy.
-   **Latency Telemetry Capture**: Calculate and expose Time to First Token
    (TTFT), Time to First User Facing Token (TFUFT), and total latency.
-   **Dual Metric Definition**: Support for both LLM-as-a-Judge rubrics and
    programmatic evaluator modules.

## Data Privacy and Governance

To ensure security and compliance with enterprise data policies, Gemini
Enterprise Eval Studio is designed with a strict client-side, stateless
architecture:

1.  **GCP Tenant Isolation**: The tool operates entirely within the user's
    Google Cloud Platform (GCP) tenant. All computations, evaluation runs, and
    data storage occur within your controlled environment.
2.  **No Google Data Collection**: Google does not collect, store, or have
    access to your customer data, queries, evaluation inputs, or evaluation
    results processed by this tool.
3.  **Governing Agreements**: Any data handling and API calls made by the tool
    are governed solely by the customer's existing agreements with Google Cloud
    for the specific APIs used (e.g., Vertex AI APIs).

## Running Locally

To run the development server using npm and Angular CLI:

1.  **Install dependencies**:
    ```sh
    npm install
    ```

2.  **Start the development server**:
    ```sh
    npm start
    ```
    or if you have `@angular/cli` installed globally:
    ```sh
    ng serve
    ```
    By default, it listens on port 4200. To serve on a different port, use the
    `--port` option:
    ```sh
    ng serve --port 8080
    ```
