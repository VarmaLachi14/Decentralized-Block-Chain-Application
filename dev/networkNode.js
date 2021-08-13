const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const Blockchain = require('./blockchain');
const uuid = require('uuid/v1');
const port = process.argv[2];
const rp = require('request-promise');

const nodeAddress = uuid().split('-').join('');

const cryptocurrency = new Blockchain();


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));


app.get('/blockchain', function (req, res) {
  res.send(cryptocurrency);
});


app.post('/transaction', function(req, res) {
	const newTransaction = req.body;
	const blockIndex = cryptocurrency.addTransactionToPendingTransactions(newTransaction);
	res.json({ note: `Transaction will be added in block ${blockIndex}.` });
});


app.post('/transaction/broadcast', function(req, res) {
	const newTransaction = cryptocurrency.createNewTransaction(req.body.amount, req.body.sender, req.body.recipient);
	cryptocurrency.addTransactionToPendingTransactions(newTransaction);

	const requestPromises = [];
	cryptocurrency.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/transaction',
			method: 'POST',
			body: newTransaction,
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises)
	.then(data => {
		res.json({ note: 'Transaction created and broadcast successfully.' });
	});
});


app.get('/mine', function(req, res) {
	const lastBlock = cryptocurrency.getLastBlock();
	const previousBlockHash = lastBlock['hash'];
	const currentBlockData = {
		transactions: cryptocurrency.pendingTransactions,
		index: lastBlock['index'] + 1
	};
	const nonce = cryptocurrency.proofOfWork(previousBlockHash, currentBlockData);
	const blockHash = cryptocurrency.hashBlock(previousBlockHash, currentBlockData, nonce);
	const newBlock = cryptocurrency.createNewBlock(nonce, previousBlockHash, blockHash);

	const requestPromises = [];
	cryptocurrency.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/receive-new-block',
			method: 'POST',
			body: { newBlock: newBlock },
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises)
	.then(data => {
		const requestOptions = {
			uri: cryptocurrency.currentNodeUrl + '/transaction/broadcast',
			method: 'POST',
			body: {
				amount: 12.5,
				sender: "00",
				recipient: nodeAddress
			},
			json: true
		};

		return rp(requestOptions);
	})
	.then(data => {
		res.json({
			note: "New block mined & broadcast successfully",
			block: newBlock
		});
	});
});


app.post('/receive-new-block', function(req, res) {
	const newBlock = req.body.newBlock;
	const lastBlock = cryptocurrency.getLastBlock();
	const correctHash = lastBlock.hash === newBlock.previousBlockHash; 
	const correctIndex = lastBlock['index'] + 1 === newBlock['index'];

	if (correctHash && correctIndex) {
		cryptocurrency.chain.push(newBlock);
		cryptocurrency.pendingTransactions = [];
		res.json({
			note: 'New block received and accepted.',
			newBlock: newBlock
		});
	} else {
		res.json({
			note: 'New block rejected.',
			newBlock: newBlock
		});
	}
});

app.post('/register-and-broadcast-node', function(req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	if (cryptocurrency.networkNodes.indexOf(newNodeUrl) == -1) cryptocurrency.networkNodes.push(newNodeUrl);

	const regNodesPromises = [];
	cryptocurrency.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/register-node',
			method: 'POST',
			body: { newNodeUrl: newNodeUrl },
			json: true
		};

		regNodesPromises.push(rp(requestOptions));
	});

	Promise.all(regNodesPromises)
	.then(data => {
		const bulkRegisterOptions = {
			uri: newNodeUrl + '/register-nodes-bulk',
			method: 'POST',
			body: { allNetworkNodes: [ ...cryptocurrency.networkNodes, cryptocurrency.currentNodeUrl ] },
			json: true
		};

		return rp(bulkRegisterOptions);
	})
	.then(data => {
		res.json({ note: 'New node registered with network successfully.' });
	});
});


app.post('/register-node', function(req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	const nodeNotAlreadyPresent = cryptocurrency.networkNodes.indexOf(newNodeUrl) == -1;
	const notCurrentNode = cryptocurrency.currentNodeUrl !== newNodeUrl;
	if (nodeNotAlreadyPresent && notCurrentNode) cryptocurrency.networkNodes.push(newNodeUrl);
	res.json({ note: 'New node registered successfully.' });
});


app.post('/register-nodes-bulk', function(req, res) {
	const allNetworkNodes = req.body.allNetworkNodes;
	allNetworkNodes.forEach(networkNodeUrl => {
		const nodeNotAlreadyPresent = cryptocurrency.networkNodes.indexOf(networkNodeUrl) == -1;
		const notCurrentNode = cryptocurrency.currentNodeUrl !== networkNodeUrl;
		if (nodeNotAlreadyPresent && notCurrentNode) cryptocurrency.networkNodes.push(networkNodeUrl);
	});

	res.json({ note: 'Bulk registration successful.' });
});

app.get('/consensus', function(req, res) {
	const requestPromises = [];
	cryptocurrency.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/blockchain',
			method: 'GET',
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises)
	.then(blockchains => {
		const currentChainLength = cryptocurrency.chain.length;
		let maxChainLength = currentChainLength;
		let newLongestChain = null;
		let newPendingTransactions = null;

		blockchains.forEach(blockchain => {
			if (blockchain.chain.length > maxChainLength) {
				maxChainLength = blockchain.chain.length;
				newLongestChain = blockchain.chain;
				newPendingTransactions = blockchain.pendingTransactions;
			};
		});


		if (!newLongestChain || (newLongestChain && !cryptocurrency.chainIsValid(newLongestChain))) {
			res.json({
				note: 'Current chain has not been replaced.',
				chain: cryptocurrency.chain
			});
		}
		else {
			cryptocurrency.chain = newLongestChain;
			cryptocurrency.pendingTransactions = newPendingTransactions;
			res.json({
				note: 'This chain has been replaced.',
				chain: cryptocurrency.chain
			});
		}
	});
});


app.get('/block/:blockHash', (req, res)=>{ 
	const blockHash = req.params.blockHash
	const correctBlock = cryptocurrency.getBlock(blockHash)
	res.json({
		block:correctBlock
	})
})

app.get('/transaction/:transactionId',(req,res)=>{
	const transactionId = req.params.transactionId;
	const trasactionData = cryptocurrency.getTransaction(transactionId);
	res.json({
		transaction: trasactionData.transaction,
		block: trasactionData.block
	});
})

app.get('/block-explorer', function(req, res) {
	res.sendFile('./block-explorer/index.html', { root: __dirname })
})


app.listen(port, function() {
	console.log(`Listening on port ${port}...`);
});





