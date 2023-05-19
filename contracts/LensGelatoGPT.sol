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

    function setFee(uint256 _fee) external onlyProxyAdmin {
        fee = _fee;
    }

    function collectFee(address payable _to) external onlyProxyAdmin {
        _to.sendValue(address(this).balance);
    }

    function setPrompt (
        uint256 _profileId,
        string calldata _prompt
    ) onlyProfileOwner(_profileId) external payable  {
    
        require(msg.value == fee, "LensGelatoGPT.setPrompt: fee");
        require(
            bytes(_prompt).length <= 160,
            "LensGelatoGPT.setPrompt: length"
        );
        require(
            lensHub.getDispatcher(_profileId) == dedicatedMsgSender,
            "LensGelatoGPT.setPrompt: dispatcher"
        );
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

    function getPaginatedPrompts(
        uint256 _from,
        uint256 _to
    ) external view returns (Prompt[] memory results) {
        require(_from < _to, "LensGelatoGPT.getPaginatedPrompts: _to");
        require(
            _from <= _profiles.length(),
            "LensGelatoGPT.getPaginatedPrompts: _from"
        );

        if (_to >= _profiles.length()) _to = _profiles.length();

        results = new Prompt[](_to - _from);

        for (uint256 i = _from; i < _to; i++) {
            uint256 profileId = _profiles.at(i);
            Prompt memory prompt = Prompt(
                profileId,
                promptByProfileId[profileId]
            );
            results[i - _from] = prompt;
        }
    }
}
