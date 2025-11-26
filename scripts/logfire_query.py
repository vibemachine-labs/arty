#!/usr/bin/env python3
"""
Query Logfire API - Multi-purpose script for querying logs
"""
import os
import requests
import json
import sys

# Read API key from .env_DIS file
def load_api_key():
    env_file = ".env_DIS"
    api_key = None

    with open(env_file, 'r') as f:
        for line in f:
            if line.startswith('LOGFIRE_READ_TOKEN='):
                api_key = line.split('=', 1)[1].strip()
                break

    if not api_key:
        print("Error: Could not find Logfire read token in .env_DIS")
        exit(1)

    return api_key

# Execute SQL query against Logfire
def run_query(sql_query, show_full=False):
    api_key = load_api_key()

    base_url = "https://logfire-api.pydantic.dev"
    query_endpoint = f"{base_url}/v1/query"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    params = {
        "sql": sql_query
    }

    print(f"Querying: {query_endpoint}")
    print(f"SQL: {sql_query}\n")

    try:
        response = requests.get(query_endpoint, params=params, headers=headers, timeout=30)

        if response.status_code == 200:
            data = response.json()

            if show_full:
                print(json.dumps(data, indent=2))
            else:
                # Pretty print just the values
                print("Results:")
                print("-" * 80)
                if "columns" in data:
                    for col in data["columns"]:
                        print(f"\n{col['name']}:")
                        for value in col["values"]:
                            print(f"  {value}")
                print("-" * 80)

            return data
        else:
            print(f"Error: Status {response.status_code}")
            print(response.text)
            return None
    except Exception as e:
        print(f"Error: {e}")
        return None

# List all projects (service names)
def list_projects():
    print("=== Listing all Logfire projects ===\n")
    sql = "SELECT DISTINCT service_name FROM records ORDER BY service_name"
    return run_query(sql)

# Query logs for a specific project
def query_project(project_name="vibemachine", limit=5):
    print(f"=== Last {limit} logs from '{project_name}' ===\n")
    sql = f"""
        SELECT start_timestamp, level, span_name, message, attributes
        FROM records
        WHERE service_name = '{project_name}'
        ORDER BY start_timestamp DESC
        LIMIT {limit}
    """
    return run_query(sql)

# Custom SQL query
def custom_query(sql):
    print(f"=== Custom Query ===\n")
    return run_query(sql, show_full=True)

# Main menu
def main():
    if len(sys.argv) < 2:
        print("""
Logfire Query Tool
==================

Usage:
  python3 logfire_query.py [command] [options]

Commands:
  list-projects              List all Logfire projects
  query [project] [limit]    Query logs from project (default: vibemachine, 5)
  sql "SELECT ..."           Run custom SQL query

Examples:
  python3 logfire_query.py list-projects
  python3 logfire_query.py query vibemachine 10
  python3 logfire_query.py sql "SELECT * FROM records LIMIT 5"
        """)
        return

    command = sys.argv[1]

    if command == "list-projects":
        list_projects()

    elif command == "query":
        project = sys.argv[2] if len(sys.argv) > 2 else "vibemachine"
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        query_project(project, limit)

    elif command == "sql":
        if len(sys.argv) < 3:
            print("Error: SQL query required")
            print('Example: python3 logfire_query.py sql "SELECT * FROM records LIMIT 5"')
            return
        sql = sys.argv[2]
        custom_query(sql)

    else:
        print(f"Unknown command: {command}")
        print("Run without arguments to see usage")

if __name__ == "__main__":
    main()
