var express = require("express");
var http = require("http");
var websocket = require("ws");

var indexRouter = require("./routes/index");
var messages = require("./public/javascripts/messages");

var gameStatus = require("./statTracker");
var Game = require("./game");

var port = process.argv[2];
var app = express();

app.set("view engine", "ejs");
app.use(express.static(__dirname + "/public"));

app.get("/play", indexRouter);

//TODO: move to routes/index
app.get("/", (req, res) => {
    res.render("splash.ejs", { gamesInitialized: gameStatus.gamesInitialized, gamesCompleted: gameStatus.gamesCompleted });
});

var server = http.createServer(app);
const wss = new websocket.Server({ server });

var websockets = {};//key: websocket, value: game

//regularly clean up the websockets object
setInterval(function() {
    for(let i in websockets){
        if(websockets.hasOwnProperty(i)){
            let gameObj = websockets[i];
            //if the gameObj has a final status, the game is complete/aborted
            if(gameObj.finalStatus!=null){
                console.log("\tDeleting element "+i);
                delete websockets[i];
            }
        }
    }
}, 50000);

var currentGame = new Game(gameStatus.gamesInitialized++);
var connectionID = 0;//ID given to each websocket

wss.on("connection", function connection(ws) {

    /* Two-player game: every two players are added to the same game  ... */
    let con = ws; 
    con.id = connectionID++;
    let playerType = currentGame.addPlayer(con);
    websockets[con.id] = currentGame;

    console.log("Player %s placed in game %s as %s", con.id, currentGame.id, playerType);

    //inform the player about its assigned player type
    con.send((playerType == "A") ? messages.S_PLAYER_A : messages.S_PLAYER_B);

    //if player B, send target word (if available)
    if(playerType == "B" && currentGame.getWord()!=null){
        let msg = messages.O_TARGET_WORD;
        msg.data = currentGame.getWord();
        con.send(JSON.stringify(msg));
    }

    //if the currentGame object has two players, create a new object
    if (currentGame.hasTwoConnectedPlayers()) {
        currentGame = new Game();
    }

    /* When a player from a game sends a message, 
     * determine the other player and send the message to him */
    con.on("message", function incoming(message) {

        let oMsg = JSON.parse(message);
 
        //game instance of the player
        let gameObj = websockets[con.id];
        let isPlayerA = (gameObj.playerA == con) ? true : false;

        //Player A can set the target word - if we have a player B, send it to him
        if( oMsg.type!=undefined && oMsg.type == messages.T_TARGET_WORD && isPlayerA==true) {
            gameObj.setWord(oMsg.data);

            if(gameObj.hasTwoConnectedPlayers()){
                let msg = messages.O_TARGET_WORD;
                msg.data = gameObj.getWord();
                gameObj.playerB.send(JSON.stringify(msg)); 
            }
        }

        //Player B can make a guess, which is forwarded to player A
        if( oMsg.type!=undefined && oMsg.type == messages.T_MAKE_A_GUESS && isPlayerA==false){
            gameObj.playerA.send(message);
        }

        //Player B has the right to claim who won/lost
        if( oMsg.type!=undefined && oMsg.type == messages.T_GAME_WON_BY && isPlayerA==false){
            gameObj.setFinalStatus(oMsg.data);
            //game was won by somebody, update statistics
            gameStatus.gamesCompleted++;
        }
    });

    con.on("close", function(){
       
        //lets wait a second before reacting ... if the game status has changed, no need to deal with this

        //alternative explanation of a close event is one websocket being closed (e.g. browser tab closes), inform the other player
        console.log(con.id + " disconnected ...");

        setTimeout(function() {

            if(websockets.hasOwnProperty(con.id)){

                let gameObj = websockets[con.id];

                if(gameObj.finalStatus == null){

                    gameObj.finalStatus="ABORTED";
                    gameStatus.gamesAborted++;

                    try {
                        gameObj.playerA.close();
                        gameObj.playerA = null;
                    }
                    catch(e){
                        console.log("Player A closing: "+ e);
                    }

                    try {
                        gameObj.playerB.close(); 
                        gameObj.playerB = null;
                    }
                    catch(e){
                        console.log("Player B closing: " + e);
                    }
                }
            }

        }, 1000);
    });
});

server.listen(port);

