function writeSse(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeSseHeartbeat(res) {
  res.write(": ping\n\n");
}

module.exports = {
  writeSse,
  writeSseHeartbeat,
};
