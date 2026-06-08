import argparse
import socket
from collections.abc import Sequence

import uvicorn


def is_port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False

    return True


def find_available_port(host: str, start_port: int, max_attempts: int) -> int:
    for port in range(start_port, start_port + max_attempts):
        if is_port_available(host, port):
            return port

    raise RuntimeError(
        f"No available port found from {start_port} to "
        f"{start_port + max_attempts - 1}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7001)
    parser.add_argument("--max-port-attempts", type=int, default=20)
    parser.add_argument("--ws-ping-interval", type=float, default=30.0)
    parser.add_argument("--ws-ping-timeout", type=float, default=180.0)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)

    port = find_available_port(args.host, args.port, args.max_port_attempts)
    if port != args.port:
        print(f"Port {args.port} is in use. Starting backend on port {port}.")

    uvicorn.run(
        "main:app",
        host=args.host,
        port=port,
        reload=True,
        ws_ping_interval=args.ws_ping_interval,
        ws_ping_timeout=args.ws_ping_timeout,
    )


if __name__ == "__main__":
    main()
