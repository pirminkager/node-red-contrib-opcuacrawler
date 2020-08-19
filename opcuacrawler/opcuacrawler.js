module.exports = function (RED) {
    "use strict";
    var { 
        OPCUAClient,
        ClientSession,
        NodeCrawler,
        CacheNode,
        UserData,
        BrowseDirection,
        NodeClass,
        CacheNodeVariable,
        DataType,
        SecurityPolicy,
        MessageSecurityMode
    } = require("node-opcua");
    var coerceNodeId = require("node-opcua-nodeid").coerceNodeId;
    var async = require("async");
    var path = require("path");

    function OpcUaCrawlerNode(config) {

        RED.nodes.createNode(this, config);

        this.name = config.name;
        this.item = config.item; // OPC UA address: ns=2;i=4 OR ns=3;s=MyVariable
        this.topic = config.topic; // ns=3;s=MyVariable from input
        this.items = config.items;

        var node = this;

        var browseTopic = "ns=5;i=1009"; // Default root, server Objects
        //var nodeId = "ns=5;i=1009";
        var nodeId = node.item;
        //var endpointUrl = "opc.tcp://192.168.0.10:4840";
        var opcuaEndpoint = RED.nodes.getNode(config.endpoint);

        var connectionOption = {};
        connectionOption.securityPolicy = SecurityPolicy[opcuaEndpoint.securityPolicy] || SecurityPolicy.None;
        connectionOption.securityMode = MessageSecurityMode[opcuaEndpoint.securityMode] || MessageSecurityMode.NONE;
        // These are not used, wrong options to get connection to server
        // If certificate is needed then read it through endpoint as bytes
        // connectionOption.certificateFile = path.join(__dirname, "../../node_modules/node-opcua-client/certificates/client_selfsigned_cert_1024.pem");
        // connectionOption.privateKeyFile = path.join(__dirname, "../../node_modules/node-opcua-client/certificates/PKI/own/private/private_key.pem");
        connectionOption.endpoint_must_exist = false;
        //node.status({
        //    fill: "gray",
        //    shape: "dot",
        //    text: "waiting for inject"
        //});
        setstatus("yellow","waiting for inject");

        async function crawl() {
            try {
                function onBrowse(crawler, cacheNode, userData) {
                    if (cacheNode.nodeClass === NodeClass.ReferenceType) {
                        return;
                    }
                    //const node = { "@": {} };
                    const node = {};
        
                    //node["@"].nodeClass = NodeClass[cacheNode.nodeClass];
        
                    if (cacheNode.nodeClass === NodeClass.Variable) {
                        const cacheNodeVariable = cacheNode;
                        node.dataType = DataType[cacheNodeVariable.dataType.value];
                        //if (typeof cacheNodeVariable.dataValue.value.value !== "object") {
                        //    node.value = cacheNodeVariable.dataValue.value.value;
                        //} else {
                        //    node.value = cacheNodeVariable.dataValue.value.value;
                        //}
                        node.nodeId = cacheNodeVariable.nodeId;
                        node.description = cacheNodeVariable.description.text;
                        node.browseName = cacheNodeVariable.browseName.name;
                    }
                    const myUserData = {
                        onBrowse,
                        root: node,
                    };
                    try{
                        userData.root[cacheNode.browseName.name.toString()] = node;
                    } catch (err) {
                        node_error("Error parsing nodeId");
                    }
                    if (cacheNode.nodeClass === NodeClass.Variable) {
                        return;
                    }
                    NodeCrawler.follow(crawler, cacheNode, myUserData, "Organizes", BrowseDirection.Forward);
                    NodeCrawler.follow(crawler, cacheNode, myUserData, "HasComponent", BrowseDirection.Forward);
                    NodeCrawler.follow(crawler, cacheNode, myUserData, "HasProperty", BrowseDirection.Forward);
                }
        
                const client = OPCUAClient.create({ endpoint_must_exist: false });
                client.on("backoff", () => { console.log("keep trying to connect"); });
                const pojo = await client.withSessionAsync(opcuaEndpoint.endpoint, async (session) => {
                    const crawler = new NodeCrawler(session);
                    const userData = { onBrowse, root: {} };
                    await crawler.crawl(nodeId, userData);
                    return userData.root;
                });
                //console.log(JSON.stringify(pojo, null, " "));
                //console.log(js2xml.parse("data", pojo));
                return pojo;
            } catch (err) {
                console.log(err);
                process.exit(1);
            }
        };

        async function sendresult() {
            var newmsg = {payload:{}};
            setstatus("yellow","Browsing");
            const theresult = await crawl();
            //console.log("browesd");
            newmsg.payload = theresult;
            if (Object.keys(newmsg.payload).length != 0) {
                node.send(newmsg);
                setstatus("green","Done");
            } else {
                setstatus("red","Error");
            }
        }

        node.on("input", function (msg) {

            browseTopic = null;

            node.warn("input browser");
            
            if (msg.hasOwnProperty('topic')) {
                if (msg.topic != '') {
                    nodeId = msg.topic;
                }
            }
            if (msg.payload.hasOwnProperty('ns') && msg.payload.hasOwnProperty('id') && msg.payload.hasOwnProperty('type')) {
                if (msg.payload.type == 's' || msg.payload.type == 'i') {
                    nodeId = "ns="+msg.payload.ns+";"+msg.payload.type+"="+msg.payload.id;
                } else {
                    node_error("wrong type defined");
                }
            }
            sendresult();

        });

        function setstatus(color,text) {
            node.status({
                fill: color,
                shape: "dot",
                text: text
            });
        }

        function node_error(err) {
            node.error(err);
            //Doesnt set it to red why?
            //setstatus("red",err);
        }
    }

    RED.nodes.registerType("OpcUa-Crawler", OpcUaCrawlerNode);
};
