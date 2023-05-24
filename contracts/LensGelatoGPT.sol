// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "hardhat/console.sol";
import {Proxied} from "./vendor/hardhat-deploy/Proxied.sol";
import {ILensHub} from "./lens/ILensHub.sol";
import {
    AddressUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import {
    EnumerableSetUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

struct Prompt {
    uint256 profileId;
    string prompt;
}

contract LensGelatoGPT is Proxied {
    using AddressUpgradeable for address payable;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.UintSet;

    ILensHub public immutable lensHub;

    address public immutable dedicatedMsgSender;

    uint256 public fee;

    mapping(uint256 => string) public promptByProfileId;

    EnumerableSetUpgradeable.UintSet private _profiles;

    EnumerableSetUpgradeable.UintSet private _newcomers;

    constructor(ILensHub _lensHub, address _dedicatedMsgSender) {
        lensHub = _lensHub;
        dedicatedMsgSender = _dedicatedMsgSender;
    }

    modifier onlyProfileOwner(uint256 _profileId) {
        require(
            msg.sender == lensHub.ownerOf(_profileId),
            "LensGelatoGPT.onlyProfileOwner"
        );
        _;
    }

    modifier onlyDedicatedMsgSender() {
        require(
            msg.sender == dedicatedMsgSender,
            "LensGelatoGPT.onlyDedicatedMsgSender"
        );
        _;
    }

    function setFee(uint256 _fee) external onlyProxyAdmin {
        fee = _fee;
    }

    function collectFee(address payable _to) external onlyProxyAdmin {
        _to.sendValue(address(this).balance);
    }

    function setPrompt(
        uint256 _profileId,
        string calldata _prompt
    ) external payable onlyProfileOwner(_profileId) {
        require(msg.value == fee, "LensGelatoGPT.setPrompt: fee");
        require(
            bytes(_prompt).length <= 160,
            "LensGelatoGPT.setPrompt: length"
        );
        require(
            lensHub.getDispatcher(_profileId) == dedicatedMsgSender,
            "LensGelatoGPT.setPrompt: dispatcher"
        );
        // If first propmt will track in newcomers enumerable map

        _newcomers.add(_profileId);

        _profiles.add(_profileId);
        promptByProfileId[_profileId] = _prompt;
    }

    function stopPrompt(
        uint256 _profileId
    ) external onlyProfileOwner(_profileId) {
        require(
            _profiles.contains(_profileId),
            "LensGelatoGPT.stopPrompt: 404"
        );
        _profiles.remove(_profileId);
        delete promptByProfileId[_profileId];
    }

    // Executed

    function availableNewcomers() external view returns (bool available) {
        available = _newcomers.length() > 0;
    }

    function updateNewcomersSet(
        uint256 _toDeleteNewcomers
    ) external onlyDedicatedMsgSender {
        uint256[] memory toDeleteArray = new uint256[](_toDeleteNewcomers);
        for (uint256 i = 0; i < _toDeleteNewcomers; i++) {
            uint256 profileId = _newcomers.at(i);
            toDeleteArray[i] = profileId;
        }
         
        for (uint256 i = 0; i < _toDeleteNewcomers; i++) {
            _newcomers.remove(toDeleteArray[i]);
        }
           
    }

    function getPaginatedPrompts(
        uint256 _from,
        bool _inRun
    )
        external
        view
        returns (
            Prompt[] memory results,
            uint256 nextPromptIndex,
            uint256 newcomersPointer
        )
    {
        // require(_from < _to, "LensGelatoGPT.getPaginatedPrompts: _to");
        require(
            _from <= _profiles.length(),
            "LensGelatoGPT.getPaginatedPrompts: _from"
        );

        nextPromptIndex = _from;

        // if (_to >= _profiles.length()) _to = _profiles.length();
        newcomersPointer = 0;
        uint256 resultsLength;

 

        // include newcomersinto results array;
        (results, resultsLength) = getNewcomers();
        newcomersPointer = newcomersPointer + resultsLength;

        if (resultsLength == 10 || !_inRun) {
            return (results, nextPromptIndex, newcomersPointer);
        }

        for (uint256 i = _from; i < _profiles.length(); i++) {
            uint256 profileId = _profiles.at(i);
            // check if dispatcher still valid
            if (lensHub.getDispatcher(profileId) == dedicatedMsgSender) {
                results[resultsLength] = getPrompt(profileId);
                resultsLength++;
                nextPromptIndex++;

                if (resultsLength == 10) {
                    return (results, nextPromptIndex, newcomersPointer);
                }
            }
        }
    }

    //// internal Functions
    function getNewcomers()
        internal
        view
        returns (Prompt[] memory results, uint256 resultsLength)
    {
        results = new Prompt[](10);

        if (_newcomers.length() > 0) {
            for (uint256 i = 0; i < _newcomers.length(); i++) {
                uint256 profileId = _newcomers.at(i);
                // check if dispatcher still valid

                if (lensHub.getDispatcher(profileId) == dedicatedMsgSender) {
                    results[resultsLength] = getPrompt(profileId);
                    if (resultsLength == 10) {
                        return (results, resultsLength);
                    }
                }
                resultsLength++;
            }
        }
    }

    function getPrompt(
        uint256 profileId
    ) internal view returns (Prompt memory prompt) {
        prompt = Prompt(profileId, promptByProfileId[profileId]);
    }
}
