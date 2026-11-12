# syntax=docker/dockerfile:1
FROM golang:1.27 AS build
WORKDIR /src

# Module download layer, cached until go.mod/go.sum change.
COPY go.mod go.sum ./
RUN go mod download

COPY cmd/clocktower ./cmd/clocktower
COPY internal ./internal
COPY web ./web
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/clocktower ./cmd/clocktower

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/BackSlasher/clocktower" \
      org.opencontainers.image.title="clocktower" \
      org.opencontainers.image.description="Co-op steampunk tower defence: TV as the board, phones as controllers"
COPY --from=build /out/clocktower /clocktower
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/clocktower"]
