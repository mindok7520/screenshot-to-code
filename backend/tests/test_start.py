import start


def test_find_available_port_skips_bound_port(monkeypatch):
    monkeypatch.setattr(
        start,
        "is_port_available",
        lambda _host, port: port == 7003,
    )

    assert start.find_available_port("127.0.0.1", 7001, 20) == 7003


def test_main_passes_websocket_keepalive_settings_to_uvicorn(monkeypatch):
    run_calls: list[dict[str, object]] = []

    def fake_run(app: str, **kwargs: object) -> None:
        run_calls.append({"app": app, **kwargs})

    monkeypatch.setattr(start, "is_port_available", lambda _host, _port: True)
    monkeypatch.setattr(start.uvicorn, "run", fake_run)

    start.main(
        [
            "--host",
            "0.0.0.0",
            "--port",
            "7010",
            "--ws-ping-interval",
            "45",
            "--ws-ping-timeout",
            "240",
        ]
    )

    assert run_calls == [
        {
            "app": "main:app",
            "host": "0.0.0.0",
            "port": 7010,
            "reload": True,
            "ws_ping_interval": 45.0,
            "ws_ping_timeout": 240.0,
        }
    ]


def test_main_uses_next_available_port(monkeypatch):
    run_calls: list[dict[str, object]] = []

    def fake_run(app: str, **kwargs: object) -> None:
        run_calls.append({"app": app, **kwargs})

    monkeypatch.setattr(
        start,
        "is_port_available",
        lambda _host, port: port == 7002,
    )
    monkeypatch.setattr(start.uvicorn, "run", fake_run)

    start.main(["--host", "127.0.0.1", "--port", "7001"])

    assert run_calls[0]["port"] == 7002
