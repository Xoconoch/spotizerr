import subprocess
import logging
import time
import threading

# Import Celery task utilities
from .celery_config import get_config_params, MAX_CONCURRENT_DL

# Configure logging
logger = logging.getLogger(__name__)

# Configuration
CONFIG_PATH = "./data/config/main.json"
CELERY_APP = "routes.utils.celery_tasks.celery_app"
CELERY_PROCESS = None
CONFIG_CHECK_INTERVAL = 30  # seconds


class CeleryManager:
    """
    Manages Celery workers dynamically based on configuration changes.
    """

    def __init__(self, app_name="routes.utils.celery_tasks"):
        self.app_name = app_name
        self.download_worker_process = None
        self.utility_worker_process = None
        self.download_log_thread_stdout = None
        self.download_log_thread_stderr = None
        self.utility_log_thread_stdout = None
        self.utility_log_thread_stderr = None
        self.stop_event = threading.Event()
        self.config_monitor_thread = None
        # self.concurrency now specifically refers to download worker concurrency
        self.concurrency = get_config_params().get(
            "maxConcurrentDownloads", MAX_CONCURRENT_DL
        )
        logger.info(
            f"CeleryManager initialized. Download concurrency set to: {self.concurrency}"
        )

    def _get_worker_command(
        self, queues, concurrency, worker_name_suffix, log_level="INFO"
    ):
        # Use a unique worker name to avoid conflicts.
        # %h is replaced by celery with the actual hostname.
        hostname = f"worker_{worker_name_suffix}@%h"
        command = [
            "celery",
            "-A",
            self.app_name,
            "worker",
            "--loglevel=" + log_level,
            "-Q",
            queues,
            "-c",
            str(concurrency),
            "--hostname=" + hostname,
            "--pool=prefork",
        ]
        # Optionally add --without-gossip, --without-mingle, --without-heartbeat
        # if experiencing issues or to reduce network load, but defaults are usually fine.
        # Example: command.extend(["--without-gossip", "--without-mingle"])
        logger.debug(f"Generated Celery command: {' '.join(command)}")
        return command

    def _process_output_reader(self, stream, log_prefix, error=False):
        logger.debug(f"Log reader thread started for {log_prefix}")
        try:
            for line in iter(stream.readline, ""):
                if line:
                    log_method = logger.error if error else logger.info
                    log_method(f"{log_prefix}: {line.strip()}")
                elif (
                    self.stop_event.is_set()
                ):  # If empty line and stop is set, likely EOF
                    break
            # Loop may also exit if stream is closed by process termination
        except ValueError:  # ValueError: I/O operation on closed file
            if not self.stop_event.is_set():
                logger.error(
                    f"Error reading Celery output from {log_prefix} (ValueError - stream closed unexpectedly?)",
                    exc_info=False,
                )  # Don't print full trace for common close error
            else:
                logger.info(
                    f"{log_prefix} stream reader gracefully stopped due to closed stream after stop signal."
                )
        except Exception as e:
            logger.error(
                f"Unexpected error in log reader for {log_prefix}: {e}", exc_info=True
            )
        finally:
            if hasattr(stream, "close") and not stream.closed:
                stream.close()
            logger.info(f"{log_prefix} stream reader thread finished.")

    def start(self):
        self.stop_event.clear()  # Clear stop event before starting

        # Start Download Worker
        if self.download_worker_process and self.download_worker_process.poll() is None:
            logger.info("Celery Download Worker is already running.")
        else:
            self.concurrency = get_config_params().get(
                "maxConcurrentDownloads", self.concurrency
            )
            download_cmd = self._get_worker_command(
                queues="downloads",
                concurrency=self.concurrency,
                worker_name_suffix="dlw",  # Download Worker
            )
            logger.info(
                f"Starting Celery Download Worker with command: {' '.join(download_cmd)}"
            )
            self.download_worker_process = subprocess.Popen(
                download_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True,
            )
            self.download_log_thread_stdout = threading.Thread(
                target=self._process_output_reader,
                args=(self.download_worker_process.stdout, "Celery[DW-STDOUT]"),
            )
            self.download_log_thread_stderr = threading.Thread(
                target=self._process_output_reader,
                args=(self.download_worker_process.stderr, "Celery[DW-STDERR]", True),
            )
            self.download_log_thread_stdout.start()
            self.download_log_thread_stderr.start()
            logger.info(
                f"Celery Download Worker (PID: {self.download_worker_process.pid}) started with concurrency {self.concurrency}."
            )

        # Start Utility Worker
        if self.utility_worker_process and self.utility_worker_process.poll() is None:
            logger.info("Celery Utility Worker is already running.")
        else:
            utility_cmd = self._get_worker_command(
                queues="utility_tasks,default",  # Listen to utility and default
                concurrency=3,
                worker_name_suffix="utw",  # Utility Worker
            )
            logger.info(
                f"Starting Celery Utility Worker with command: {' '.join(utility_cmd)}"
            )
            self.utility_worker_process = subprocess.Popen(
                utility_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True,
            )
            self.utility_log_thread_stdout = threading.Thread(
                target=self._process_output_reader,
                args=(self.utility_worker_process.stdout, "Celery[UW-STDOUT]"),
            )
            self.utility_log_thread_stderr = threading.Thread(
                target=self._process_output_reader,
                args=(self.utility_worker_process.stderr, "Celery[UW-STDERR]", True),
            )
            self.utility_log_thread_stdout.start()
            self.utility_log_thread_stderr.start()
            logger.info(
                f"Celery Utility Worker (PID: {self.utility_worker_process.pid}) started with concurrency 3."
            )

        if (
            self.config_monitor_thread is None
            or not self.config_monitor_thread.is_alive()
        ):
            self.config_monitor_thread = threading.Thread(
                target=self._monitor_config_changes
            )
            self.config_monitor_thread.daemon = (
                True  # Allow main program to exit even if this thread is running
            )
            self.config_monitor_thread.start()
            logger.info("CeleryManager: Config monitor thread started.")
        else:
            logger.info("CeleryManager: Config monitor thread already running.")

    def _monitor_config_changes(self):
        logger.info(
            "CeleryManager: Config monitor thread active, monitoring configuration changes..."
        )
        while not self.stop_event.is_set():
            try:
                time.sleep(10)  # Check every 10 seconds
                if self.stop_event.is_set():
                    break

                current_config = get_config_params()
                new_max_concurrent_downloads = current_config.get(
                    "maxConcurrentDownloads", self.concurrency
                )

                if new_max_concurrent_downloads != self.concurrency:
                    logger.info(
                        f"CeleryManager: Detected change in maxConcurrentDownloads from {self.concurrency} to {new_max_concurrent_downloads}. Restarting download worker only."
                    )

                    # Stop only the download worker
                    if (
                        self.download_worker_process
                        and self.download_worker_process.poll() is None
                    ):
                        logger.info(
                            f"Stopping Celery Download Worker (PID: {self.download_worker_process.pid}) for config update..."
                        )
                        self.download_worker_process.terminate()
                        try:
                            self.download_worker_process.wait(timeout=10)
                            logger.info(
                                f"Celery Download Worker (PID: {self.download_worker_process.pid}) terminated."
                            )
                        except subprocess.TimeoutExpired:
                            logger.warning(
                                f"Celery Download Worker (PID: {self.download_worker_process.pid}) did not terminate gracefully, killing."
                            )
                            self.download_worker_process.kill()
                        self.download_worker_process = None

                    # Wait for log threads of download worker to finish
                    if (
                        self.download_log_thread_stdout
                        and self.download_log_thread_stdout.is_alive()
                    ):
                        self.download_log_thread_stdout.join(timeout=5)
                    if (
                        self.download_log_thread_stderr
                        and self.download_log_thread_stderr.is_alive()
                    ):
                        self.download_log_thread_stderr.join(timeout=5)

                    self.concurrency = new_max_concurrent_downloads

                    # Restart only the download worker
                    download_cmd = self._get_worker_command(
                        "downloads", self.concurrency, "dlw"
                    )
                    logger.info(
                        f"Restarting Celery Download Worker with command: {' '.join(download_cmd)}"
                    )
                    self.download_worker_process = subprocess.Popen(
                        download_cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        bufsize=1,
                        universal_newlines=True,
                    )
                    self.download_log_thread_stdout = threading.Thread(
                        target=self._process_output_reader,
                        args=(self.download_worker_process.stdout, "Celery[DW-STDOUT]"),
                    )
                    self.download_log_thread_stderr = threading.Thread(
                        target=self._process_output_reader,
                        args=(
                            self.download_worker_process.stderr,
                            "Celery[DW-STDERR]",
                            True,
                        ),
                    )
                    self.download_log_thread_stdout.start()
                    self.download_log_thread_stderr.start()
                    logger.info(
                        f"Celery Download Worker (PID: {self.download_worker_process.pid}) restarted with new concurrency {self.concurrency}."
                    )

            except Exception as e:
                logger.error(
                    f"CeleryManager: Error in config monitor thread: {e}", exc_info=True
                )
                # Avoid busy-looping on continuous errors
                if not self.stop_event.is_set():
                    time.sleep(30)
        logger.info("CeleryManager: Config monitor thread stopped.")

    def _stop_worker_process(self, worker_process, worker_name):
        if worker_process and worker_process.poll() is None:
            logger.info(
                f"Terminating Celery {worker_name} Worker (PID: {worker_process.pid})..."
            )
            worker_process.terminate()
            try:
                worker_process.wait(timeout=10)
                logger.info(
                    f"Celery {worker_name} Worker (PID: {worker_process.pid}) terminated."
                )
            except subprocess.TimeoutExpired:
                logger.warning(
                    f"Celery {worker_name} Worker (PID: {worker_process.pid}) did not terminate gracefully, killing."
                )
                worker_process.kill()
        return None  # Set process to None after stopping

    def stop(self):
        logger.info("CeleryManager: Stopping Celery workers...")
        self.stop_event.set()  # Signal all threads to stop

        # Stop download worker
        self.download_worker_process = self._stop_worker_process(
            self.download_worker_process, "Download"
        )

        # Stop utility worker
        self.utility_worker_process = self._stop_worker_process(
            self.utility_worker_process, "Utility"
        )

        logger.info("Joining log threads...")
        thread_timeout = 5  # seconds to wait for log threads

        # Join download worker log threads
        if (
            self.download_log_thread_stdout
            and self.download_log_thread_stdout.is_alive()
        ):
            self.download_log_thread_stdout.join(timeout=thread_timeout)
        if (
            self.download_log_thread_stderr
            and self.download_log_thread_stderr.is_alive()
        ):
            self.download_log_thread_stderr.join(timeout=thread_timeout)

        # Join utility worker log threads
        if self.utility_log_thread_stdout and self.utility_log_thread_stdout.is_alive():
            self.utility_log_thread_stdout.join(timeout=thread_timeout)
        if self.utility_log_thread_stderr and self.utility_log_thread_stderr.is_alive():
            self.utility_log_thread_stderr.join(timeout=thread_timeout)

        if self.config_monitor_thread and self.config_monitor_thread.is_alive():
            logger.info("Joining config_monitor_thread...")
            self.config_monitor_thread.join(timeout=thread_timeout)

        logger.info(
            "CeleryManager: All workers and threads signaled to stop and joined."
        )

    def restart(self):
        logger.info("CeleryManager: Restarting all Celery workers...")
        self.stop()
        # Short delay before restarting
        logger.info("Waiting a brief moment before restarting workers...")
        time.sleep(2)
        self.start()
        logger.info("CeleryManager: All Celery workers restarted.")


# Global instance for managing Celery workers
celery_manager = CeleryManager()

# Example of how to use the manager (typically called from your main app script)
if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] [%(threadName)s] [%(name)s] - %(message)s",
    )
    logger.info("Starting Celery Manager example...")
    celery_manager.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received, stopping Celery Manager...")
    finally:
        celery_manager.stop()
        logger.info("Celery Manager example finished.")
