# @digicat/termination-manager

The one true way of terminating services.

Termination tasks can be added with different priorities. Tasks are executed in
descending priority order. Tasks with the same priority are terminated
concurrently.

Takes callback functions which application code can use to log messages.

Supports configurable grace periods to ensure the process does terminate.

Handles `SIGINT` and `SIGTERM` signals and listens for uncaught exceptions and
unhandled rejections. When these signals are received, the process is terminated
gracefully. Uncaught exceptions and unhandled rejections cause the process to be
terminated with a 0 millisecond grace period.

Requires [Node.js](https://nodejs.org/en/) 8.6 or later.

## Usage

```js
const TerminationManager = require('@digicat/termination-manager')

const manager = new TerminationManager({
  // Default grace period, in milliseconds
  grace: 5000,

  // How long to wait, in milliseconds, for the event loop to drain, before
  // forcibly terminating the process.
  drainGrace: 5000,

  // Called when it takes longer than `drainGrace` for the event loop to drain.
  // The process is terminated immediately after this callback returns.
  onDrainTimeout () {},

  // Called when the `SIGINT` signal is received. The process starts to
  // gracefully exit after this callback returns.
  onSigint () {},

  // Called when the `SIGTERM` signal is received. The process starts to
  // gracefully exit after this callback returns.
  onSigterm () {},

  // Called when an error occurs while stopping a task.
  onStopError (err) {},

  // Called when an uncaught exception occurs. The process is terminated with a
  // 0ms grace period and an exit code of 1 as soon as this callback returns.
  onUncaughtException (err) {},

  // Called when an unhandled rejection occurs. The process is terminated with a
  // 0ms grace period and an exit code of 1 as soon as this callback returns.
  onUnhandledRejection () {}
})

// Add a termination task, for instance to close a database connection. Returns
// the manager instance so calls can be chained.
manager.add({
  // The name must be a non-empty string.
  name: 'db'

  // Tasks are run in priority order. Priorities must be non-negative integers.
  // Defaults to 0.
  priority: 0,

  // The stop() method must implement the logic for gracefully stopping a
  // resource (e.g. a database connection). Receives the allowed grace period
  // (in milliseconds). If the method returns a promise, it must fulfil before
  // either 100ms or 110% of the grace period have passed (whichever is larger).
  //
  // Failure to do so causes a stop error. These can be identified by their
  // `name` property, which will be `StopTimeoutError`. The task object and
  // grace period are available through the `task` and `grace` properties
  // respectively.
  //
  // Exceptions are caught and also cause a stop error.
  //
  // Stop errors prevent any other tasks from running, leading to a disgraceful
  // termination. The exit code will be set to 1, unless it's already set to a
  // non-zero value.
  async stop (grace) {
    // …
  }
})

// Make the process terminate with an exit code of 1, and a grace period of 0ms.
// Termination tasks are still called but are given very little time to
// complete.
manager.crash()

// Make the process terminate with the given exit code and grace period. The
// grace period defaults to the one provided in the constructor. Can be called
// without any arguments.
manager.exit({code = 0, grace = 5000})
```
