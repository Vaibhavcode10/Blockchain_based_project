// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract QuestionPaperVault {
    address public admin;

    struct Paper {
        string paperHash; // Hash / IPFS CID of the encrypted paper payload
        bool exists;
    }
        
    mapping(uint256 => Paper) public papers;
    mapping(uint256 => address[]) public accessLogs;
    mapping(uint256 => mapping(address => bool)) public hasAccessed;
    mapping(address => uint256) public accessNonces;

    event PaperCreated(uint256 indexed paperId, string paperHash);
    event PaperAccessed(
        uint256 indexed paperId,
        address indexed viewer, 
        bytes32 indexed appUserId,
        uint256 timestamp
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can perform this action");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function createPaper(uint256 paperId, string memory _paperHash) public onlyAdmin {
        require(!papers[paperId].exists, "Paper already exists");
        papers[paperId] = Paper(_paperHash, true);
        emit PaperCreated(paperId, _paperHash);
    }

    function accessPaper(
        uint256 paperId,
        bytes32 appUserId,
        uint256 deadline,
        uint256 nonce,
        bytes calldata signature
    ) public {
        require(papers[paperId].exists, "Paper does not exist");
        require(appUserId != bytes32(0), "Invalid app user");
        require(block.timestamp <= deadline, "Access authorization expired");
        require(nonce == accessNonces[msg.sender], "Invalid access nonce");

        bytes32 accessHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                paperId,
                msg.sender,
                appUserId,
                deadline,
                nonce
            )
        );
        bytes32 signedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", accessHash)
        );
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signature);
        require(ecrecover(signedHash, v, r, s) == admin, "Invalid access authorization");
        accessNonces[msg.sender] = nonce + 1;

        if (!hasAccessed[paperId][msg.sender]) {
            hasAccessed[paperId][msg.sender] = true;
            accessLogs[paperId].push(msg.sender);
        }

        emit PaperAccessed(paperId, msg.sender, appUserId, block.timestamp);
    }

    function getAccessLogs(uint256 paperId) public view returns (address[] memory) {
        return accessLogs[paperId];
    }

    function _splitSignature(bytes calldata signature)
        private
        pure
        returns (bytes32 r, bytes32 s, uint8 v)
    {
        require(signature.length == 65, "Invalid signature");
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, "Invalid signature");
    }
}