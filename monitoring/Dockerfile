FROM grafana/agent:v0.40.0

COPY agent-config.yaml /etc/agent/agent.yaml

ENTRYPOINT ["/bin/grafana-agent"]
CMD ["-config.file=/etc/agent/agent.yaml", "-config.expand-env=true"]
