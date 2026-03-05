# My Backend Project

This project is a FastAPI application that utilizes Uvicorn as the ASGI server. The following instructions will help you set up and run the backend server.

## Project Structure

```
my-backend-project
├── .vscode
│   └── tasks.json
└── README.md
```

## Backend Startup

To automate the backend startup, a task named "Start Backend" has been configured in the `.vscode/tasks.json` file. This task runs the command to start the Uvicorn server for the FastAPI application.

### Running the Task

To run the "Start Backend" task from the "Run Task" menu, follow these steps:

1. Open the Command Palette (Ctrl + Shift + P or Cmd + Shift + P on Mac).
2. Type "Run Task" and select it from the dropdown.
3. Choose "Start Backend" from the list of available tasks.

This will execute the task without needing to type the command in the terminal again.